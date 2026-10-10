import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import mongoose from 'mongoose'
import { env } from '../config/env.mjs'
import { assessOcrConfidence } from '../processing/ocrConfidenceGate.mjs'
import { recognizeDocument } from '../processing/localOcr.mjs'
import Application from '../models/Application.mjs'
import Document from '../models/Document.mjs'
import { createAuditEvent } from './auditService.mjs'
import { findActiveDuplicateDocument } from './activeDuplicateDocumentService.mjs'
import {
  readOriginal,
  removeStorageFile,
  storeExtractedText,
  storeOriginal,
} from './documentStorage.mjs'

const supportedTypes = new Map([
  ['.pdf', { mimeType: 'application/pdf', signature: (buffer) => buffer.subarray(0, 5).toString() === '%PDF-' }],
  ['.png', { mimeType: 'image/png', signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['.jpg', { mimeType: 'image/jpeg', signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['.jpeg', { mimeType: 'image/jpeg', signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
])

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function safeOriginalFilename(filename) {
  const baseName = path.basename(String(filename || '').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .slice(0, 255)
  return baseName || 'document'
}

function validateUploadedFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw requestError('A non-empty document file is required.', 400)
  }
  if (file.size !== file.buffer.length || file.size > env.MAX_UPLOAD_SIZE_BYTES) {
    throw requestError('The document exceeds the maximum upload size.', 413)
  }

  const extension = path.extname(file.originalname || '').toLowerCase()
  const type = supportedTypes.get(extension)
  if (!type || file.mimetype !== type.mimeType || !type.signature(file.buffer)) {
    throw requestError('Only valid PDF, PNG, and JPEG documents are supported.', 415)
  }
  return { extension: extension === '.jpeg' ? '.jpg' : extension, mimeType: type.mimeType }
}

export function serializeDocument(document) {
  const id = String(document._id || document.id)
  return {
    id,
    name: document.originalFilename,
    status: document.ocrStatus,
    addedAt: document.createdAt,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    ocrConfidence: document.ocrConfidence,
    ocrThreshold: document.ocrThreshold,
    humanVerificationRequired: document.humanVerificationRequired,
    humanVerificationStatus: document.humanVerificationStatus,
  }
}

export async function createApplicantDocument({ actor, applicationId, file }) {
  const applicantId = actor?.id
  if (!mongoose.isValidObjectId(applicationId)) return null
  const application = await Application.findOne({ _id: applicationId, applicantId })
  if (!application) return null
  if (application.status !== 'DRAFT') {
    throw requestError('Documents can only be uploaded while the application is a draft.', 409)
  }
  const { extension, mimeType } = validateUploadedFile(file)
  const contentHash = createHash('sha256').update(file.buffer).digest('hex')
  if (actor.role === 'APPLICANT' || actor.role === 'GENERAL_OFFICER') {
    const duplicate = await findActiveDuplicateDocument({
      applicantId,
      applicationId: application._id,
      contentHashes: [contentHash],
    })
    if (duplicate) {
      throw requestError(
        `This file is already included in your active ${duplicate.applicationType} application. You can submit it again after that application is rejected or completed.`,
        409,
      )
    }
  }
  const storageId = await storeOriginal(file.buffer, extension)
  let document
  try {
    document = await Document.create({
      applicationId: application._id,
      applicantId,
      originalFilename: safeOriginalFilename(file.originalname),
      contentHash,
      documentType: mimeType,
      mimeType,
      fileSize: file.size,
      originalStorageId: storageId,
      ocrStatus: 'PROCESSING',
    })
  } catch (error) {
    await removeStorageFile(storageId, extension)
    throw error
  }
  await createAuditEvent({
    applicationId: application._id,
    documentId: document._id,
    actor,
    action: 'DOCUMENT_UPLOADED',
    previousStatus: null,
    newStatus: document.ocrStatus,
  })

  try {
    const original = await readOriginal(storageId, extension)
    const { text, confidence, diagnostics } = await recognizeDocument({ buffer: original, mimeType })
    if (env.NODE_ENV !== 'production') {
      console.info('[DOCUMENT_OCR]', JSON.stringify({
        applicationId: String(application._id),
        documentId: String(document._id),
        provider: diagnostics.provider,
        model: diagnostics.model,
        confidenceScale: diagnostics.confidenceScale,
        pageCount: diagnostics.pageCount,
        characterCount: diagnostics.characterCount,
        wordCount: diagnostics.wordCount,
        blockCount: diagnostics.blockCount,
        lineCount: diagnostics.lineCount,
        paragraphCount: diagnostics.paragraphCount,
        tableCount: diagnostics.tableCount,
        missingConfidencePageCount: diagnostics.missingConfidencePageCount,
        ocrConfidence: confidence,
        ocrThreshold: env.OCR_THRESHOLD,
      }))
    }
    const assessment = assessOcrConfidence(confidence)
    const extractedTextStorageId = await storeExtractedText(randomUUID(), text)
    document.extractedTextStorageId = extractedTextStorageId
    document.ocrStatus = assessment.ocrStatus
    document.ocrConfidence = assessment.ocrScore
    document.ocrThreshold = assessment.ocrThreshold
    document.humanVerificationRequired = assessment.humanVerificationRequired
    document.humanVerificationStatus = assessment.humanVerificationStatus
    await document.save()
  } catch (error) {
    document.ocrStatus = 'FAILED'
    document.ocrFailureCode = error?.message?.includes('page OCR limit') ? 'PDF_PAGE_LIMIT' : 'OCR_PROCESSING_FAILED'
    await document.save()
    await createAuditEvent({
      applicationId: application._id,
      documentId: document._id,
      actor,
      action: 'OCR_FAILED',
      previousStatus: 'PROCESSING',
      newStatus: 'FAILED',
      reason: document.ocrFailureCode,
    })
    throw requestError(
      document.ocrFailureCode === 'PDF_PAGE_LIMIT'
        ? `OCR is limited to PDFs with at most ${env.MAX_PDF_PAGES} pages. The file was stored but could not be processed.`
        : 'The document was stored, but OCR processing failed. Please retry later.',
      422,
    )
  }
  await createAuditEvent({
    applicationId: application._id,
    documentId: document._id,
    actor,
    action: 'OCR_COMPLETED',
    previousStatus: 'PROCESSING',
    newStatus: document.ocrStatus,
    reason: `Confidence ${document.ocrConfidence}; threshold ${document.ocrThreshold}.`,
  })
  return serializeDocument(document)
}

export async function getApplicantDocument(applicantId, documentId) {
  if (!mongoose.isValidObjectId(documentId)) return null
  const document = await Document.findOne({ _id: documentId, applicantId }).select('+originalStorageId').lean()
  if (!document) return null

  return openDocument(document)
}

export async function getPendingVerificationDocument(documentId) {
  if (!mongoose.isValidObjectId(documentId)) return null
  const document = await Document.findOne({
    _id: documentId,
    humanVerificationRequired: true,
    humanVerificationStatus: { $in: ['PENDING', 'IN_REVIEW'] },
  }).select('+originalStorageId').lean()
  if (!document) return null

  return openDocument(document)
}

export async function getOfficerOriginalDocument(officerId, departmentId, documentId) {
  if (!mongoose.isValidObjectId(officerId) || !mongoose.isValidObjectId(departmentId) ||
      !mongoose.isValidObjectId(documentId)) return null
  const document = await Document.findById(documentId).select('+originalStorageId').lean()
  if (!document) return null
  const application = await Application.findOne({
    _id: document.applicationId,
    departmentId,
    assignedOfficerId: officerId,
    status: { $in: ['OFFICER_REVIEW', 'ASSIGNED', 'UNDER_REVIEW'] },
  }).select('_id').lean()
  if (!application) return null
  const blockedDocuments = await Document.exists({
    applicationId: application._id,
    $or: [
      { ocrStatus: { $in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      { humanVerificationRequired: true, humanVerificationStatus: { $in: ['PENDING', 'IN_REVIEW', 'CORRECTION_REQUIRED'] } },
    ],
  })
  if (blockedDocuments) return null

  const extension = document.mimeType === 'application/pdf'
    ? '.pdf'
    : document.mimeType === 'image/png'
      ? '.png'
      : '.jpg'
  const content = await readOriginal(document.originalStorageId, extension)
  return { document: serializeDocument(document), content }
}

export async function getGeneralOfficerOriginalDocument(generalOfficerId, documentId) {
  if (!mongoose.isValidObjectId(generalOfficerId) || !mongoose.isValidObjectId(documentId)) return null
  const document = await Document.findById(documentId).select('+originalStorageId').lean()
  if (!document) return null
  const application = await Application.findOne({
    _id: document.applicationId,
    status: 'ESCALATED',
  }).select('_id').lean()
  if (!application) return null
  const blockedDocuments = await Document.exists({
    applicationId: application._id,
    $or: [
      { ocrStatus: { $in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      { humanVerificationRequired: true, humanVerificationStatus: { $in: ['PENDING', 'IN_REVIEW', 'CORRECTION_REQUIRED'] } },
    ],
  })
  if (blockedDocuments) return null

  return openDocument(document)
}

async function openDocument(document) {
  const extension = document.mimeType === 'application/pdf'
    ? '.pdf'
    : document.mimeType === 'image/png'
      ? '.png'
      : '.jpg'
  const content = await readOriginal(document.originalStorageId, extension)
  return { document: serializeDocument(document), content }
}

export async function cleanupDocumentStorage(document) {
  if (document?.originalStorageId) {
    const extension = document.mimeType === 'application/pdf'
      ? '.pdf'
      : document.mimeType === 'image/png'
        ? '.png'
        : '.jpg'
    await removeStorageFile(document.originalStorageId, extension)
  }
  if (document?.extractedTextStorageId) {
    await removeStorageFile(document.extractedTextStorageId, '.txt')
  }
}

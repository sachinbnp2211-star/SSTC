import mongoose from 'mongoose'
import { env } from '../config/env.mjs'
import Application, {
  ACTIVE_APPLICATION_STATUSES,
  APPLICATION_STATUSES,
} from '../models/Application.mjs'
import Document from '../models/Document.mjs'
import Department from '../models/Department.mjs'
import { createAuditEvent } from './auditService.mjs'
import { readExtractedText } from './documentStorage.mjs'
import {
  createInsufficientOcrTextReason,
  createVerificationReason,
  getOcrVerificationReason,
} from './verificationReasonService.mjs'
import {
  assessDocumentQualityText,
  classifyDocumentText,
  DocumentClassificationError,
} from './documentClassificationService.mjs'
import { getLowConfidenceAutomationConfig } from '../config/processingConfig.mjs'
import {
  calculateOcrQualityMetrics,
  calculateVerifiedFieldCompleteness,
  decideDocumentQuality,
  hasSevereOcrNoise,
} from './documentQualityService.mjs'
import { assignApplication } from './applicationAssignmentService.mjs'
import { findActiveDuplicateDocument } from './activeDuplicateDocumentService.mjs'
import {
  advanceApplicationToOfficerReview,
  recordApplicationProcessingTransition,
  recordApplicationStatusTransition,
  routeApplicationToHumanVerification,
} from './applicationLifecycleService.mjs'

function validationError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function normalizeApplicationType(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function validateApplicationData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw validationError('Application information is required.')
  }

  const requiredFields = ['applicationType', 'title', 'applicantName', 'contactEmail', 'details']
  for (const field of requiredFields) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      throw validationError(`${field} is required.`)
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail.trim())) {
    throw validationError('Enter a valid contact email address.')
  }
  if (data.applicationType.trim().length > 120 ||
      data.title.trim().length > 160 ||
      data.applicantName.trim().length > 160 ||
      data.contactEmail.trim().length > 254 ||
      data.details.trim().length > 10000) {
    throw validationError('One or more application fields exceed the allowed length.')
  }
}

export function serializeApplication(application, documents = []) {
  const record = application.toObject ? application.toObject() : application
  const id = String(record._id || record.id)
  const department = record.departmentId && typeof record.departmentId === 'object' &&
    record.departmentId.name
    ? record.departmentId
    : null
  const officer = record.assignedOfficerId && typeof record.assignedOfficerId === 'object' &&
    record.assignedOfficerId.displayName
    ? record.assignedOfficerId
    : null
  return {
    id,
    applicationId: id,
    applicantId: String(record.applicantId),
    applicationType: record.applicationType,
    title: record.applicationData.title,
    applicantName: record.applicationData.applicantName,
    contactEmail: record.applicationData.contactEmail,
    details: record.applicationData.details,
    status: record.status,
    processingDecision: record.processingDecision || null,
    automationAssessment: record.automationAssessment || null,
    humanVerificationReason: record.humanVerificationReason,
    verificationReasons: record.verificationReasons || [],
    rejectionReason: record.status === 'REJECTED'
      ? record.officerReview?.reason || null
      : null,
    rejectedAt: record.status === 'REJECTED'
      ? record.officerReview?.decidedAt || null
      : null,
    department: department?.name || null,
    departmentId: department ? String(department._id) : record.departmentId ? String(record.departmentId) : null,
    assignedOfficerId: officer ? String(officer._id) : record.assignedOfficerId ? String(record.assignedOfficerId) : null,
    assignedOfficerName: officer?.displayName || null,
    deadlineAt: null,
    breachedAt: null,
    documents,
    timeline: [
      {
        id: `${id}-created`,
        label: 'Draft created',
        at: record.createdAt.toISOString(),
      },
      ...(record.submittedAt
        ? [{ id: `${id}-submitted`, label: 'Submitted', at: record.submittedAt.toISOString() }]
        : []),
    ],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
  }
}

export async function createApplicantApplication(actor, data) {
  validateApplicationData(data)
  const applicantId = actor?.id
  if (!mongoose.isValidObjectId(applicantId)) {
    const error = new Error('Authenticated applicant identity is invalid.')
    error.statusCode = 401
    throw error
  }

  const application = await Application.create({
    applicantId,
    applicationType: data.applicationType.trim(),
    applicationData: {
      title: data.title.trim(),
      applicantName: data.applicantName.trim(),
      contactEmail: data.contactEmail.trim().toLowerCase(),
      details: data.details.trim(),
    },
    status: 'DRAFT',
  })
  await createAuditEvent({
    applicationId: application._id,
    actor,
    action: 'APPLICATION_CREATED',
    previousStatus: null,
    newStatus: 'DRAFT',
  })
  return serializeApplication(application)
}

export async function listApplicantApplications(applicantId) {
  const applications = await Application.find({ applicantId })
    .sort({ updatedAt: -1, _id: -1 })
    .populate('departmentId', 'name')
    .populate('assignedOfficerId', 'displayName')
    .lean()
  const documents = await Document.find({ applicationId: { $in: applications.map(({ _id }) => _id) } })
    .sort({ createdAt: 1 })
    .lean()
  const documentsByApplication = new Map()
  for (const document of documents) {
    const applicationKey = String(document.applicationId)
    const list = documentsByApplication.get(applicationKey) || []
    const application = applications.find(({ _id }) => String(_id) === applicationKey)
    list.push(serializeDocument(document, application))
    documentsByApplication.set(applicationKey, list)
  }
  return applications.map((application) =>
    serializeApplication(application, documentsByApplication.get(String(application._id)) || []),
  )
}

export async function getApplicantApplication(applicantId, applicationId) {
  if (!mongoose.isValidObjectId(applicationId)) return null
  const application = await Application.findOne({ _id: applicationId, applicantId })
    .populate('departmentId', 'name')
    .populate('assignedOfficerId', 'displayName')
    .lean()
  if (!application) return null
  const documents = await Document.find({ applicationId: application._id }).sort({ createdAt: 1 }).lean()
  return serializeApplication(application, documents.map((document) => serializeDocument(document, application)))
}

function normalizeDepartmentLabel(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function departmentAliases(department) {
  const normalizedName = normalizeDepartmentLabel(department.name)
  const normalizedCode = normalizeDepartmentLabel(department.code)
  return new Set([
    normalizedName,
    normalizedName.replace(/\s+department$/, ''),
    normalizedCode,
    normalizedCode.replace(/\s+department$/, ''),
  ].filter(Boolean))
}

export function resolveClassifiedDepartment(label, departments) {
  if (typeof label !== 'string' || !label.trim() ||
      [
        'unknown',
        'unknown department',
        'department unknown',
        'undetermined',
        'not determined',
        'none',
        'n a',
        'not applicable',
      ].includes(normalizeDepartmentLabel(label))) {
    return { status: 'UNKNOWN_DEPARTMENT', department: null }
  }
  const normalized = normalizeDepartmentLabel(label)
  const matches = departments.filter((department) => departmentAliases(department).has(normalized))
  if (matches.length === 1) return { status: 'SUCCESS', department: matches[0] }
  return { status: 'INVALID_AI_CLASSIFICATION', department: null }
}

function logClassification(applicationId, document, status, details = {}) {
  console.info('[CLASSIFICATION]', JSON.stringify({
    applicationId: String(applicationId),
    documentId: String(document._id),
    status,
    documentType: details.documentType || null,
    department: details.department || null,
    confidence: Number.isFinite(details.confidence) ? details.confidence : null,
    ...(details.reasonCode ? { reasonCode: details.reasonCode } : {}),
  }))
}

export async function submitApplicantApplication(actor, applicationId, {
  classifyDocument = classifyDocumentText,
  assessDocumentQuality = assessDocumentQualityText,
} = {}) {
  const applicantId = actor?.id
  if (!mongoose.isValidObjectId(applicationId)) return null
  const application = await Application.findOne({ _id: applicationId, applicantId })
  if (!application) return null
  if (!APPLICATION_STATUSES.includes(application.status) || application.status !== 'DRAFT') {
    const error = new Error(`Cannot submit an application with status ${application.status}.`)
    error.statusCode = 409
    throw error
  }

  if (actor.role === 'APPLICANT' || actor.role === 'GENERAL_OFFICER') {
    const normalizedApplicationType = normalizeApplicationType(application.applicationType)
    const activeApplications = await Application.find({
      applicantId,
      _id: { $ne: application._id },
      status: { $in: ACTIVE_APPLICATION_STATUSES },
    }).select('applicationType').lean()
    if (activeApplications.some(({ applicationType }) =>
      normalizeApplicationType(applicationType) === normalizedApplicationType)) {
      const displayType = application.applicationType.trim().replace(/\s+/g, ' ')
      const error = new Error(
        `You already have an active ${displayType} application. You can submit another one after the current application is rejected or completed.`,
      )
      error.statusCode = 409
      throw error
    }
  }

  validateApplicationData({
    applicationType: application.applicationType,
    ...application.applicationData,
  })
  if (actor.role === 'APPLICANT') {
    const applicationDocuments = await Document.find({ applicationId: application._id })
      .select('+contentHash')
      .lean()
    const duplicate = await findActiveDuplicateDocument({
      applicantId,
      applicationId: application._id,
      contentHashes: applicationDocuments.map(({ contentHash }) => contentHash),
    })
    if (duplicate) {
      const displayType = duplicate.applicationType.trim().replace(/\s+/g, ' ')
      const error = new Error(
        `This file is already included in your active ${displayType} application. You can submit it again after that application is rejected or completed.`,
      )
      error.statusCode = 409
      throw error
    }
  }
  application.status = 'SUBMITTED'
  application.submittedAt = new Date()
  await application.save()
  await recordApplicationStatusTransition({
    applicationId: application._id,
    previousStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    actor,
    action: 'APPLICATION_SUBMITTED',
  })
  await recordApplicationProcessingTransition(application._id, actor)
  const documentsForOcr = await Document.find({ applicationId: application._id })
    .select('+extractedTextStorageId +contentHash ocrStatus ocrConfidence ocrThreshold ocrFailureCode originalFilename')
    .lean()
  const verificationReasons = []
  const automationConfig = getLowConfidenceAutomationConfig(env)
  const documentsForClassification = []
  const automationAssessment = {
    requiredFieldCount: 0,
    completeFieldCount: 0,
    evidenceSupportedFieldCount: 0,
    confidenceQualifiedFieldCount: 0,
  }
  for (const document of documentsForOcr) {
    if (document.ocrStatus === 'FAILED') {
      verificationReasons.push(getOcrVerificationReason(document, env.MAX_PDF_PAGES))
      continue
    }
    const extractedText = document.extractedTextStorageId
      ? await readExtractedText(document.extractedTextStorageId)
      : ''
    if (!extractedText.trim()) {
      verificationReasons.push(document.ocrStatus === 'LOW_CONFIDENCE'
        ? getOcrVerificationReason(document, env.MAX_PDF_PAGES)
        : createVerificationReason({
            code: 'INSUFFICIENT_OCR_TEXT',
            document,
          }))
      continue
    }
    if (!['COMPLETED', 'LOW_CONFIDENCE'].includes(document.ocrStatus) ||
        !Number.isFinite(document.ocrConfidence)) {
      verificationReasons.push(getOcrVerificationReason({
        ...document,
        ocrStatus: 'FAILED',
        ocrFailureCode: document.ocrFailureCode || 'OCR_PROCESSING_FAILED',
      }, env.MAX_PDF_PAGES))
      continue
    }
    const needsQualityAssessment = document.ocrConfidence < automationConfig.ocrThreshold
    if (!needsQualityAssessment) {
      documentsForClassification.push({ document, extractedText, qualityAssessment: null })
      continue
    }

    const metrics = calculateOcrQualityMetrics(extractedText)
    await Document.updateOne(
      { _id: document._id, applicationId: application._id },
      { $set: { ocrQualityMetrics: metrics } },
    )
    documentsForClassification.push({
      document,
      extractedText,
      qualityAssessment: null,
      needsQualityAssessment,
      metrics,
    })
  }
  if (verificationReasons.length) {
    console.info('[PIPELINE]', JSON.stringify({
      applicationId: String(application._id),
      fallback: 'HUMAN_VERIFICATION',
      reasonCodes: verificationReasons.map(({ code }) => code),
    }))
    await routeApplicationToHumanVerification(
      application._id,
      actor,
      verificationReasons.map(({ message, documentName }) => `${documentName}: ${message}`).join(' '),
      verificationReasons,
    )
  } else if (documentsForClassification.length) {
    const departments = await Department.find({ isActive: true })
      .select('_id name code')
      .sort({ name: 1, _id: 1 })
      .lean()
    const successfulClassifications = []
    const preparedDocuments = []
    for (const item of documentsForClassification) {
      const { document, extractedText, needsQualityAssessment, metrics } = item
      if (!needsQualityAssessment) {
        preparedDocuments.push({ document, extractedText, qualityAssessment: null })
        continue
      }

      let qualityAssessment
      try {
        qualityAssessment = await assessDocumentQuality(extractedText)
      } catch {
        verificationReasons.push(createVerificationReason({
          code: 'AI_DOCUMENT_QUALITY_LOW',
          document,
          failureDescription: 'AI document-quality assessment could not be completed safely.',
        }))
        continue
      }
      if (document.ocrConfidence < automationConfig.confidenceFloor) {
        verificationReasons.push(createVerificationReason({
          code: 'OCR_BELOW_MINIMUM_SAFE',
          document,
          minimumSafeThreshold: automationConfig.confidenceFloor,
        }))
        continue
      }
      if (metrics.textLength < automationConfig.minimumTextLength ||
          metrics.wordCount < automationConfig.qualityMinimumWordCount) {
        verificationReasons.push(createInsufficientOcrTextReason(
          document,
          automationConfig.minimumTextLength,
        ))
        continue
      }
      if (hasSevereOcrNoise(metrics, automationConfig)) {
        verificationReasons.push(createVerificationReason({
          code: 'AI_DOCUMENT_QUALITY_LOW',
          document,
          fieldNames: [],
          failureDescription: 'Deterministic OCR quality metrics exceeded the configured noise limits.',
        }))
        continue
      }
      const verifiedFields = calculateVerifiedFieldCompleteness({
        documentType: qualityAssessment.documentType,
        fields: qualityAssessment.fields,
        ocrText: extractedText,
        minimumFieldConfidence: automationConfig.criticalFieldConfidence,
      })
      const qualityDecision = decideDocumentQuality({
        ocrConfidence: document.ocrConfidence,
        ocrMetrics: metrics,
        qualityAssessment,
        verifiedFieldCompleteness: verifiedFields,
        config: automationConfig,
      })
      await Document.updateOne(
        { _id: document._id, applicationId: application._id },
        {
          $set: {
            qualityAssessment: {
              status: qualityDecision.eligible ? 'PASS' : 'REVIEW',
              reasonCode: qualityDecision.reasonCode,
              documentType: qualityAssessment.documentType,
              isReadable: qualityAssessment.isReadable,
              qualityScore: qualityAssessment.qualityScore,
              modelFieldCompleteness: qualityAssessment.fieldCompleteness,
              verifiedFieldCompleteness: verifiedFields.fieldCompleteness,
              ocrNoiseScore: qualityAssessment.ocrNoiseScore,
              safeForAutomation: qualityAssessment.safeForAutomation,
              consistency: qualityAssessment.consistency,
              reason: qualityAssessment.reason,
              band: qualityDecision.band || null,
              expectedFieldCount: verifiedFields.expectedFieldCount,
              completeFieldCount: verifiedFields.completeFieldCount,
              evidenceSupportedFieldCount: verifiedFields.evidenceSupportedFieldCount,
              confidenceQualifiedFieldCount: verifiedFields.confidenceQualifiedFieldCount,
              fields: qualityAssessment.fields,
            },
          },
        },
      )
      if (verifiedFields.supported) {
        automationAssessment.requiredFieldCount += verifiedFields.expectedFieldCount
        automationAssessment.completeFieldCount += verifiedFields.completeFieldCount
        automationAssessment.evidenceSupportedFieldCount += verifiedFields.evidenceSupportedFieldCount
        automationAssessment.confidenceQualifiedFieldCount += verifiedFields.confidenceQualifiedFieldCount
      }
      if (!qualityDecision.eligible) {
        verificationReasons.push(createVerificationReason({
          code: qualityDecision.reasonCode,
          document,
          predictedDocumentType: qualityAssessment.documentType,
          qualityScore: qualityAssessment.qualityScore,
          fieldCompleteness: verifiedFields.fieldCompleteness,
          ocrNoiseScore: qualityAssessment.ocrNoiseScore,
          fieldNames: verifiedFields.fieldNames,
          minimumSafeThreshold: automationConfig.hardMinimum,
        }))
        console.info('[DOCUMENT_QUALITY]', JSON.stringify({
          applicationId: String(application._id),
          documentId: String(document._id),
          decision: 'HUMAN_VERIFICATION',
          reasonCode: qualityDecision.reasonCode,
          qualityScore: qualityAssessment.qualityScore,
          fieldCompleteness: verifiedFields.fieldCompleteness,
          ocrNoiseScore: qualityAssessment.ocrNoiseScore,
        }))
        continue
      }
      preparedDocuments.push({
        document,
        extractedText,
        qualityAssessment,
      })
    }
    for (const { document, extractedText, qualityAssessment } of preparedDocuments) {
      let classification
      try {
        classification = await classifyDocument({
          text: extractedText,
          departments,
        })
      } catch (error) {
        const failureDescription = error instanceof DocumentClassificationError
          ? error.safeDescription
          : 'AI classification could not be completed.'
        await Document.updateOne(
          { _id: document._id, applicationId: application._id },
          {
            $set: {
              classification: {
                status: 'FAILED',
                failureDescription,
              },
            },
          },
        )
        logClassification(application._id, document, 'FAILED', { reasonCode: 'AI_CLASSIFICATION_FAILED' })
        verificationReasons.push(createVerificationReason({
          code: 'AI_CLASSIFICATION_FAILED',
          document,
          failureDescription,
        }))
        continue
      }

      const resolved = resolveClassifiedDepartment(classification.department, departments)
      const classificationStatus = resolved.status === 'SUCCESS'
        ? 'SUCCESS'
        : resolved.status === 'UNKNOWN_DEPARTMENT' ? 'UNKNOWN_DEPARTMENT' : 'INVALID_DEPARTMENT'
      await Document.updateOne(
        { _id: document._id, applicationId: application._id },
        {
          $set: {
            classification: {
              status: classificationStatus,
              documentType: classification.documentType,
              department: classification.department,
              departmentId: resolved.department?._id || null,
              confidence: classification.confidence,
              failureDescription: null,
            },
          },
        },
      )
      logClassification(application._id, document, classificationStatus, {
        documentType: classification.documentType,
        department: classification.department,
        confidence: classification.confidence,
        ...(resolved.status === 'SUCCESS' ? {} : { reasonCode: resolved.status }),
      })
      if (resolved.status !== 'SUCCESS') {
        verificationReasons.push(createVerificationReason({
          code: resolved.status,
          document,
          predictedDocumentType: classification.documentType,
          predictedDepartment: classification.department,
          classificationConfidence: classification.confidence,
        }))
        continue
      }
      const normalizeType = (value) => String(value || '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      if (qualityAssessment &&
          normalizeType(classification.documentType) !== normalizeType(qualityAssessment.documentType)) {
        verificationReasons.push(createVerificationReason({
          code: 'DOCUMENT_INCONSISTENT',
          document,
          predictedDocumentType: classification.documentType,
          predictedDepartment: classification.department,
          classificationConfidence: classification.confidence,
        }))
        continue
      }
      if (classification.confidence < automationConfig.classificationConfidence) {
        verificationReasons.push(createVerificationReason({
          code: 'LOW_CLASSIFICATION_CONFIDENCE',
          document,
          predictedDocumentType: classification.documentType,
          predictedDepartment: resolved.department.name,
          classificationConfidence: classification.confidence,
        }))
        continue
      }
      successfulClassifications.push({
        document,
        classification,
        department: resolved.department,
      })
    }

    if (automationAssessment.requiredFieldCount) {
      await Application.updateOne(
        { _id: application._id },
        { $set: { automationAssessment } },
      )
    }

    const distinctDepartments = new Set(successfulClassifications.map(({ department }) => String(department._id)))
    if (distinctDepartments.size > 1) {
      for (const result of successfulClassifications) {
        verificationReasons.push(createVerificationReason({
          code: 'CONFLICTING_CLASSIFICATIONS',
          document: result.document,
          predictedDocumentType: result.classification.documentType,
          predictedDepartment: result.department.name,
          classificationConfidence: result.classification.confidence,
        }))
      }
    }

    if (verificationReasons.length) {
      console.info('[PIPELINE]', JSON.stringify({
        applicationId: String(application._id),
        fallback: 'HUMAN_VERIFICATION',
        reasonCodes: verificationReasons.map(({ code }) => code),
      }))
      await routeApplicationToHumanVerification(
        application._id,
        actor,
        verificationReasons.map(({ message, documentName }) => `${documentName}: ${message}`).join(' '),
        verificationReasons,
      )
    } else {
      const selectedDepartment = successfulClassifications[0]?.department
      if (!selectedDepartment) {
        await advanceApplicationToOfficerReview(application._id, actor)
      } else {
        console.info('[ROUTING]', JSON.stringify({
          applicationId: String(application._id),
          departmentId: String(selectedDepartment._id),
        }))
        const assignment = await assignApplication(
          application._id,
          selectedDepartment._id,
          actor,
          { automatic: true },
        )
        console.info('[ASSIGNMENT]', JSON.stringify({
          applicationId: String(application._id),
          departmentId: assignment.department.id,
          officerId: assignment.assignedOfficer,
          pendingBefore: assignment.pendingBefore,
          status: assignment.application.status,
        }))
      }
    }
  } else {
    await advanceApplicationToOfficerReview(application._id, actor)
  }
  const latestApplication = await Application.findById(application._id)
    .populate('departmentId', 'name')
    .populate('assignedOfficerId', 'displayName')
  const latestDocuments = await Document.find({ applicationId: application._id }).sort({ createdAt: 1 }).lean()
  return serializeApplication(latestApplication, latestDocuments.map((document) => serializeDocument(document, latestApplication)))
}

function serializeDocument(document, application = null) {
  const id = String(document._id || document.id)
  return {
    id,
    applicationId: String(document.applicationId || application?._id || application?.id || ''),
    applicationType: application?.applicationType || null,
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

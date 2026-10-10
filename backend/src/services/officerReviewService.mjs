import mongoose from 'mongoose'
import Application from '../models/Application.mjs'
import Department from '../models/Department.mjs'
import Document from '../models/Document.mjs'
import User from '../models/User.mjs'
import { recordApplicationStatusTransition } from './applicationLifecycleService.mjs'
import { readExtractedText } from './documentStorage.mjs'

const reviewStatuses = ['OFFICER_REVIEW', 'ASSIGNED', 'UNDER_REVIEW']
const decisionStatuses = new Set(['APPROVED', 'REJECTED', 'ESCALATED'])

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function getDepartmentScope(officer) {
  if (!officer?.id || !mongoose.isValidObjectId(officer.id)) {
    throw requestError('Authenticated Officer identity is invalid.', 401)
  }
  if (!officer.departmentId || !mongoose.isValidObjectId(officer.departmentId)) {
    throw requestError('The authenticated Officer has no valid Department assignment.', 403)
  }
  return new mongoose.Types.ObjectId(officer.departmentId)
}

async function getDocumentsForApplication(applicationId, { includePrivateFields = false } = {}) {
  let query = Document.find({ applicationId }).sort({ createdAt: 1 })
  if (includePrivateFields) {
    query = query.select('+extractedTextStorageId +correctedExtractedData +humanVerificationNote')
  }
  const documents = await query.lean()
  const hasUnprocessedDocument = documents.some((document) =>
    ['PENDING', 'PROCESSING', 'FAILED'].includes(document.ocrStatus) ||
    (document.humanVerificationRequired &&
      ['PENDING', 'IN_REVIEW', 'CORRECTION_REQUIRED'].includes(document.humanVerificationStatus)),
  )
  if (hasUnprocessedDocument) {
    throw requestError('This application is not ready for Officer review.', 409)
  }
  return documents
}

function serializeDocument(document) {
  return {
    id: String(document._id),
    name: document.originalFilename,
    documentType: document.documentType || document.mimeType,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    addedAt: document.createdAt,
    ocrStatus: document.ocrStatus,
    ocrConfidence: document.ocrConfidence,
    ocrThreshold: document.ocrThreshold,
    extractedText: document.extractedText || '',
    correctedExtractedData: document.correctedExtractedData || [],
    humanVerificationRequired: document.humanVerificationRequired,
    humanVerificationStatus: document.humanVerificationStatus,
    humanVerificationDecision: document.humanVerificationDecision,
    humanVerifiedBy: document.humanVerifierName || null,
    humanVerifiedAt: document.humanVerifiedAt,
    humanVerificationNote: document.humanVerificationNote || null,
  }
}

export async function getReviewDocuments(applicationId) {
  const documents = await getDocumentsForApplication(applicationId, { includePrivateFields: true })
  const verifierIds = [...new Set(
    documents
      .filter((document) => document.humanVerifiedBy)
      .map((document) => String(document.humanVerifiedBy)),
  )]
  const verifiers = verifierIds.length
    ? await User.find({ _id: { $in: verifierIds } }).select('_id displayName governmentOfficerId').lean()
    : []
  const verifierById = new Map(verifiers.map((verifier) => [
    String(verifier._id),
    verifier.displayName || verifier.governmentOfficerId || 'Human Verifier',
  ]))

  return Promise.all(documents.map(async (document) => ({
    ...serializeDocument({
      ...document,
      humanVerifierName: document.humanVerifiedBy
        ? verifierById.get(String(document.humanVerifiedBy))
        : null,
    }),
    extractedText: document.extractedTextStorageId
      ? await readExtractedText(document.extractedTextStorageId)
      : '',
  })))
}

function serializeReviewNote(note, officerNames) {
  return {
    officerId: String(note.officerId),
    officerName: officerNames.get(String(note.officerId)) || 'Officer',
    action: note.action,
    note: note.note,
    at: note.at,
  }
}

export async function serializeOfficerApplication(application, documents = []) {
  const [applicant, department, assignedOfficer] = await Promise.all([
    User.findById(application.applicantId)
      .select('_id displayName email')
      .lean(),
    Department.findById(application.departmentId)
      .select('_id name')
      .lean(),
    application.assignedOfficerId
      ? User.findById(application.assignedOfficerId)
        .select('_id displayName governmentOfficerId')
        .lean()
      : null,
  ])
  const notes = application.officerReview?.notes || []
  const officerIds = [...new Set(notes.map((note) => String(note.officerId)))]
  const officers = officerIds.length
    ? await User.find({ _id: { $in: officerIds } }).select('_id displayName governmentOfficerId').lean()
    : []
  const officerNames = new Map(officers.map((officer) => [
    String(officer._id),
    officer.displayName || officer.governmentOfficerId || 'Officer',
  ]))

  return {
    id: String(application._id),
    applicantId: String(application.applicantId),
    applicant: applicant
      ? { id: String(applicant._id), name: applicant.displayName, email: applicant.email }
      : null,
    applicationType: application.applicationType,
    title: application.applicationData.title,
    applicantName: application.applicationData.applicantName,
    contactEmail: application.applicationData.contactEmail,
    details: application.applicationData.details,
    status: application.status,
    department: department?.name || null,
    departmentId: String(application.departmentId),
    assignedOfficerId: assignedOfficer ? String(assignedOfficer._id) : null,
    assignedOfficerName: assignedOfficer?.displayName || assignedOfficer?.governmentOfficerId || null,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    submittedAt: application.submittedAt,
    deadlineAt: null,
    breachedAt: null,
    documents,
    timeline: [
      {
        id: `${application._id}-created`,
        label: 'Draft created',
        at: application.createdAt,
      },
      ...(application.submittedAt
        ? [{
            id: `${application._id}-submitted`,
            label: 'Submitted',
            at: application.submittedAt,
          }]
        : []),
      ...notes.map((note, index) => ({
        id: `${application._id}-officer-review-${index + 1}`,
        label: note.action === 'STARTED' ? 'Officer review started' : `Officer ${note.action.toLowerCase()}`,
        detail: note.note || undefined,
        at: note.at,
      })),
    ],
    escalation: application.officerReview?.decision === 'ESCALATED'
      ? {
          originatingOfficer: officerNames.get(String(application.officerReview.decidedBy)) || 'Officer',
          createdAt: application.officerReview.decidedAt,
          note: application.officerReview.reason || '',
        }
      : undefined,
    officerReview: {
      startedBy: application.officerReview?.startedBy
        ? String(application.officerReview.startedBy)
        : null,
      startedAt: application.officerReview?.startedAt || null,
      decision: application.officerReview?.decision || null,
      decidedBy: application.officerReview?.decidedBy
        ? String(application.officerReview.decidedBy)
        : null,
      decidedAt: application.officerReview?.decidedAt || null,
      reason: application.officerReview?.reason || null,
      notes: notes.map((note) => serializeReviewNote(note, officerNames)),
    },
  }
}

async function findOfficerApplication(officer, applicationId) {
  const departmentId = getDepartmentScope(officer)
  if (!mongoose.isValidObjectId(applicationId)) return null
  return Application.findOne({
    _id: applicationId,
    departmentId,
    assignedOfficerId: officer.id,
    status: { $in: reviewStatuses },
  })
}

export async function listOfficerApplications(officer) {
  const departmentId = getDepartmentScope(officer)
  const applications = await Application.find({
    departmentId,
    assignedOfficerId: officer.id,
    status: { $in: reviewStatuses },
  }).sort({ updatedAt: -1, _id: -1 }).lean()
  const blockedDocumentApplications = await Document.distinct('applicationId', {
    applicationId: { $in: applications.map((application) => application._id) },
    $or: [
      { ocrStatus: { $in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      { humanVerificationRequired: true, humanVerificationStatus: { $in: ['PENDING', 'IN_REVIEW', 'CORRECTION_REQUIRED'] } },
    ],
  })
  const blockedIds = new Set(blockedDocumentApplications.map(String))

  return Promise.all(applications
    .filter((application) => !blockedIds.has(String(application._id)))
    .map((application) => serializeOfficerApplication(application)))
}

export async function getOfficerApplication(officer, applicationId) {
  const application = await findOfficerApplication(officer, applicationId)
  if (!application) return null
  const documents = await getReviewDocuments(application._id)
  return serializeOfficerApplication(application.toObject(), documents)
}

export async function startOfficerReview(officer, applicationId) {
  const departmentId = getDepartmentScope(officer)
  if (!mongoose.isValidObjectId(applicationId)) return null
  const existing = await Application.findOne({
    _id: applicationId,
    departmentId,
    assignedOfficerId: officer.id,
    status: { $in: ['OFFICER_REVIEW', 'ASSIGNED'] },
  }).select('_id status').lean()
  if (!existing) return null
  await getDocumentsForApplication(applicationId)
  const now = new Date()
  const updated = await Application.findOneAndUpdate(
    {
      _id: applicationId,
      departmentId,
      assignedOfficerId: officer.id,
      status: existing.status,
    },
    {
      $set: {
        status: 'UNDER_REVIEW',
        'officerReview.startedBy': officer.id,
        'officerReview.startedAt': now,
      },
      $push: {
        'officerReview.notes': {
          officerId: officer.id,
          action: 'STARTED',
          note: null,
          at: now,
        },
      },
    },
    { new: true, runValidators: true },
  )
  if (!updated) return null
  await recordApplicationStatusTransition({
    applicationId,
    previousStatus: existing.status,
    newStatus: 'UNDER_REVIEW',
    actor: officer,
    action: 'OFFICER_REVIEW_STARTED',
  })
  const documents = await getReviewDocuments(updated._id)
  return serializeOfficerApplication(updated.toObject(), documents)
}

export async function decideOfficerReview({
  officer,
  applicationId,
  decision,
  reason,
}) {
  const departmentId = getDepartmentScope(officer)
  if (!mongoose.isValidObjectId(applicationId)) return null
  if (!decisionStatuses.has(decision)) {
    throw requestError('Decision must be APPROVED, REJECTED, or ESCALATED.', 400)
  }
  if (decision !== 'APPROVED' && (typeof reason !== 'string' || !reason.trim())) {
    throw requestError('A reason is required to reject or escalate an application.', 400)
  }
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 2000)) {
    throw requestError('Review notes must not exceed 2000 characters.', 400)
  }

  const application = await Application.findOne({
    _id: applicationId,
    departmentId,
    assignedOfficerId: officer.id,
    status: 'UNDER_REVIEW',
  })
  if (!application) return null
  await getDocumentsForApplication(application._id)

  const now = new Date()
  const normalizedReason = reason?.trim() || null
  const updated = await Application.findOneAndUpdate(
    {
      _id: application._id,
      departmentId,
      assignedOfficerId: officer.id,
      status: 'UNDER_REVIEW',
    },
    {
      $set: {
        status: decision,
        'officerReview.decision': decision,
        'officerReview.decidedBy': officer.id,
        'officerReview.decidedAt': now,
        'officerReview.reason': normalizedReason,
      },
      $push: {
        'officerReview.notes': {
          officerId: officer.id,
          action: decision,
          note: normalizedReason,
          at: now,
        },
      },
    },
    { new: true, runValidators: true },
  )
  if (!updated) {
    throw requestError('The application is no longer under review.', 409)
  }
  await recordApplicationStatusTransition({
    applicationId: application._id,
    previousStatus: 'UNDER_REVIEW',
    newStatus: decision,
    actor: officer,
    action: decision === 'ESCALATED' ? 'OFFICER_ESCALATED_APPLICATION' : `OFFICER_${decision}_APPLICATION`,
    reason: normalizedReason,
  })
  return serializeOfficerApplication(updated.toObject())
}

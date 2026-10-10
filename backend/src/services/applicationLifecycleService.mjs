import Application from '../models/Application.mjs'
import Document from '../models/Document.mjs'
import { createAuditEvent } from './auditService.mjs'

const allowedTransitions = new Map([
  ['DRAFT', new Set(['SUBMITTED'])],
  ['SUBMITTED', new Set(['PROCESSING'])],
  ['PROCESSING', new Set(['OFFICER_REVIEW', 'HUMAN_VERIFICATION', 'ASSIGNED', 'WAITING_FOR_OFFICER', 'WAITING_FOR_OFFICER_ASSIGNMENT'])],
  ['HUMAN_VERIFICATION', new Set(['ASSIGNED', 'WAITING_FOR_OFFICER', 'WAITING_FOR_OFFICER_ASSIGNMENT', 'REJECTED'])],
  ['OFFICER_REVIEW', new Set(['ROUTED', 'WAITING_FOR_OFFICER', 'WAITING_FOR_OFFICER_ASSIGNMENT', 'ASSIGNED', 'UNDER_REVIEW'])],
  ['ROUTED', new Set(['WAITING_FOR_OFFICER', 'WAITING_FOR_OFFICER_ASSIGNMENT', 'ASSIGNED'])],
  ['WAITING_FOR_OFFICER', new Set(['ASSIGNED', 'WAITING_FOR_OFFICER_ASSIGNMENT'])],
  ['WAITING_FOR_OFFICER_ASSIGNMENT', new Set(['ASSIGNED'])],
  ['ASSIGNED', new Set(['UNDER_REVIEW'])],
  ['UNDER_REVIEW', new Set(['APPROVED', 'REJECTED', 'ESCALATED'])],
  ['ESCALATED', new Set(['APPROVED', 'REJECTED'])],
])

export async function recordApplicationStatusTransition({
  applicationId,
  previousStatus,
  newStatus,
  actor,
  action,
  reason = null,
}) {
  if (!allowedTransitions.get(previousStatus)?.has(newStatus)) {
    throw new Error(`Invalid application status transition: ${previousStatus} → ${newStatus}.`)
  }
  return createAuditEvent({
    applicationId,
    actor,
    action,
    previousStatus,
    newStatus,
    reason,
  })
}

export async function recordApplicationProcessingTransition(applicationId, actor) {
  const transitioned = await Application.findOneAndUpdate(
    { _id: applicationId, status: 'SUBMITTED' },
    { $set: { status: 'PROCESSING' } },
    { new: true, runValidators: true },
  )
  if (!transitioned) {
    const error = new Error('The application is no longer submitted.')
    error.statusCode = 409
    throw error
  }
  await recordApplicationStatusTransition({
    applicationId,
    previousStatus: 'SUBMITTED',
    newStatus: 'PROCESSING',
    actor,
    action: 'APPLICATION_PROCESSING_STARTED',
  })
  return transitioned
}

export async function routeApplicationToHumanVerification(
  applicationId,
  actor,
  reason,
  verificationReasons = [],
) {
  const safeReason = typeof reason === 'string' ? reason.trim().slice(0, 2000) : ''
  if (!safeReason) {
    const error = new Error('A human verification reason is required.')
    error.statusCode = 400
    throw error
  }
  const transitioned = await Application.findOneAndUpdate(
    { _id: applicationId, status: 'PROCESSING' },
    {
      $set: {
        status: 'HUMAN_VERIFICATION',
        humanVerificationRequired: true,
        humanVerificationStatus: 'PENDING',
        humanVerificationReason: safeReason,
        verificationReasons,
        processingDecision: 'HUMAN_VERIFICATION',
        processingDecisionAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  )
  if (!transitioned) {
    const error = new Error('The application is no longer available for Human Verification.')
    error.statusCode = 409
    throw error
  }
  const documentIds = verificationReasons.map(({ documentId }) => documentId)
  if (documentIds.length) {
    await Document.updateMany(
      { _id: { $in: documentIds }, applicationId },
      {
        $set: {
          humanVerificationRequired: true,
          humanVerificationStatus: 'PENDING',
        },
      },
    )
  }
  await recordApplicationStatusTransition({
    applicationId,
    previousStatus: 'PROCESSING',
    newStatus: 'HUMAN_VERIFICATION',
    actor,
    action: 'APPLICATION_HUMAN_VERIFICATION_REQUIRED',
    reason: safeReason,
  })
  return transitioned
}

export async function advanceApplicationToOfficerReview(applicationId, actor) {
  const documents = await Document.find({ applicationId })
    .select('ocrStatus humanVerificationRequired humanVerificationStatus')
    .lean()
  const allDocumentsReady = documents.every((document) =>
    document.ocrStatus === 'COMPLETED' ||
    (document.ocrStatus === 'LOW_CONFIDENCE' &&
      document.humanVerificationRequired &&
      document.humanVerificationStatus === 'VERIFIED'),
  )
  if (!allDocumentsReady) return false

  const transitioned = await Application.findOneAndUpdate(
    { _id: applicationId, status: 'PROCESSING' },
    { $set: { status: 'OFFICER_REVIEW' } },
    { new: true, runValidators: true },
  )
  if (!transitioned) return false

  await recordApplicationStatusTransition({
    applicationId,
    previousStatus: 'PROCESSING',
    newStatus: 'OFFICER_REVIEW',
    actor,
    action: 'APPLICATION_READY_FOR_OFFICER_REVIEW',
  })
  return true
}

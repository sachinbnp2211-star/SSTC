import { getOcrThreshold } from '../config/processingConfig.mjs'

export const OCR_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  FAILED: 'FAILED',
})

const VERIFIER_ROLES = new Set(['GENERAL_OFFICER', 'HUMAN_VERIFIER'])

function validateScore(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError('OCR score must be a finite percentage from 0 to 100.')
  }
}

function validateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('OCR threshold must be a finite percentage from 0 to 100.')
  }
}

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} must be provided by the backend service adapter.`)
  }
}

function requireHumanVerificationPermission(actor) {
  if (!actor?.id || !VERIFIER_ROLES.has(actor.role) ||
      !actor.permissions?.includes('HUMAN_VERIFY_OCR')) {
    throw new Error('Only an authorized human verifier can access this workflow.')
  }
}

export function assessOcrConfidence(score, threshold = getOcrThreshold()) {
  validateScore(score)
  validateThreshold(threshold)
  const humanVerificationRequired = score < threshold
  return {
    ocrScore: score,
    ocrThreshold: threshold,
    ocrStatus: humanVerificationRequired ? OCR_STATUSES.LOW_CONFIDENCE : OCR_STATUSES.COMPLETED,
    humanVerificationRequired,
    humanVerificationStatus: humanVerificationRequired ? 'PENDING' : null,
  }
}

export async function listHumanVerificationQueue(actor, services) {
  requireHumanVerificationPermission(actor)
  requireFunction(services.listPendingHumanVerifications, 'listPendingHumanVerifications')
  return services.listPendingHumanVerifications()
}

export async function getHumanVerificationReview({ documentId, actor, services }) {
  requireHumanVerificationPermission(actor)
  requireFunction(services.getPendingHumanVerification, 'getPendingHumanVerification')
  requireFunction(services.openPrivateOriginalDocument, 'openPrivateOriginalDocument')
  const record = await services.getPendingHumanVerification(documentId)
  if (!record || record.humanVerificationStatus !== 'PENDING') {
    throw new Error('This document is not available in the human verification queue.')
  }
  const originalDocument = await services.openPrivateOriginalDocument({
    storageReference: record.originalDocumentReference,
    applicationId: record.applicationId,
    documentId: record.documentId,
    actor,
  })
  return { ...record, originalDocument }
}

export function assertAutomaticRoutingAllowed(document, threshold = getOcrThreshold()) {
  validateThreshold(threshold)
  validateScore(document.ocrScore)
  if (document.ocrScore < threshold) {
    if (document.humanVerificationRequired !== true) {
      throw new Error('Low-confidence OCR must require human verification before routing.')
    }
    if (document.humanVerificationStatus !== 'VERIFIED') {
      throw new Error('Automatic routing is blocked until human verification succeeds.')
    }
    return
  }
  if (document.humanVerificationRequired === true &&
      document.humanVerificationStatus !== 'VERIFIED') {
    throw new Error('Human verification is required before automatic routing.')
  }
}

async function continueProcessing(document, services, threshold) {
  assertAutomaticRoutingAllowed(document, threshold)
  requireFunction(services.understandDocument, 'understandDocument')
  requireFunction(services.classifyDepartment, 'classifyDepartment')
  requireFunction(services.routeApplication, 'routeApplication')
  requireFunction(services.assignOfficer, 'assignOfficer')
  const understanding = await services.understandDocument(document)
  const classification = await services.classifyDepartment(document, understanding)
  const routedApplication = await services.routeApplication(document, classification)
  const assignment = await services.assignOfficer(routedApplication)
  return {
    outcome: 'ASSIGNED',
    document,
    understanding,
    classification,
    routedApplication,
    assignment,
  }
}

export async function processOcrResult(document, services, threshold = getOcrThreshold()) {
  const score = assessOcrConfidence(document.ocrScore, threshold)
  const assessedDocument = { ...document, ...score }
  if (score.humanVerificationRequired) {
    requireFunction(services.persistAndEnqueueHumanVerification, 'persistAndEnqueueHumanVerification')
    await services.persistAndEnqueueHumanVerification({
      document: assessedDocument,
      queueEntry: {
        applicationId: document.applicationId,
        documentId: document.id,
        documentType: document.documentType,
        ocrScore: score.ocrScore,
        ocrThreshold: threshold,
        ocrStatus: score.ocrStatus,
        extractedText: document.extractedText,
        originalDocumentReference: document.originalDocumentReference,
        reason: `OCR confidence ${score.ocrScore}% is below the configured threshold.`,
        submittedAt: document.submittedAt,
        humanVerificationStatus: score.humanVerificationStatus,
      },
    })
    return { outcome: 'HUMAN_VERIFICATION_REQUIRED', document: assessedDocument }
  }

  requireFunction(services.persistOcrResult, 'persistOcrResult')
  await services.persistOcrResult(assessedDocument)
  return continueProcessing(assessedDocument, services, threshold)
}

export async function resolveHumanVerification({
  document,
  actor,
  decision,
  note,
  services,
  threshold = getOcrThreshold(),
}) {
  requireHumanVerificationPermission(actor)
  validateThreshold(threshold)
  validateScore(document.ocrScore)
  if (document.ocrScore >= threshold) {
    throw new Error('Only documents below the configured OCR threshold enter human verification.')
  }
  if (!document.humanVerificationRequired ||
      document.humanVerificationStatus !== 'PENDING' ||
      document.ocrStatus !== OCR_STATUSES.LOW_CONFIDENCE) {
    throw new Error('This document is not pending human verification.')
  }
  if (decision !== 'VERIFIED' && decision !== 'REJECTED') {
    throw new Error('Human verification decision must be VERIFIED or REJECTED.')
  }
  if (decision === 'REJECTED' && !note?.trim()) {
    throw new Error('A rejection note is required.')
  }
  requireFunction(services.commitHumanVerification, 'commitHumanVerification')
  const now = new Date().toISOString()
  const resolvedDocument = {
    ...document,
    humanVerificationStatus: decision,
    humanVerifiedBy: actor.id,
    humanVerifiedAt: now,
    humanVerificationNote: note?.trim() || null,
  }

  await services.commitHumanVerification({
    document: resolvedDocument,
    expectedHumanVerificationStatus: 'PENDING',
    auditEvent: {
      type: `DOCUMENT_HUMAN_VERIFICATION_${decision}`,
      applicationId: document.applicationId,
      documentId: document.id,
      actorId: actor.id,
      actorRole: actor.role,
      occurredAt: now,
      decision,
    },
  })

  if (decision === 'REJECTED') {
    requireFunction(services.followExistingRejectionWorkflow, 'followExistingRejectionWorkflow')
    const rejection = await services.followExistingRejectionWorkflow({
      document: resolvedDocument,
      actor,
      note: resolvedDocument.humanVerificationNote,
      idempotencyKey: `human-verification-rejection:${document.id}`,
    })
    return { outcome: 'REJECTED_BY_HUMAN_VERIFICATION', document: resolvedDocument, rejection }
  }

  const result = await continueProcessing(resolvedDocument, services, threshold)
  return { ...result, document: resolvedDocument }
}

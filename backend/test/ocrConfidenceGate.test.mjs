import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertAutomaticRoutingAllowed,
  getHumanVerificationReview,
  listHumanVerificationQueue,
  processOcrResult,
  resolveHumanVerification,
} from '../src/processing/ocrConfidenceGate.mjs'
import { getOcrThreshold } from '../src/config/processingConfig.mjs'

function createServices() {
  const calls = []
  return {
    calls,
    async persistOcrResult(document) { calls.push(['persist', document]) },
    async persistAndEnqueueHumanVerification(entry) { calls.push(['persist-and-queue', entry]) },
    async understandDocument() { calls.push(['understand']); return { content: 'understood' } },
    async classifyDepartment() { calls.push(['classify']); return { departmentId: 'DEPT-1' } },
    async routeApplication() { calls.push(['route']); return { routed: true } },
    async assignOfficer() { calls.push(['assign']); return { officerId: 'OFF-1' } },
    async commitHumanVerification(event) { calls.push(['audit-and-save', event]) },
    async followExistingRejectionWorkflow() { calls.push(['existing-rejection']); return { handled: true } },
  }
}

function documentWithScore(ocrScore) {
  return {
    id: 'DOC-1',
    applicationId: 'APP-1',
    documentType: 'supporting document',
    ocrScore,
    extractedText: 'Synthetic OCR text',
    originalDocumentReference: 'private://document-1',
    submittedAt: '2026-01-01T00:00:00.000Z',
  }
}

for (const score of [75, 80, 90]) {
  test(`OCR score ${score}% continues through understanding, routing, and assignment`, async () => {
    const services = createServices()
    const result = await processOcrResult(documentWithScore(score), services, 75)
    assert.equal(result.outcome, 'ASSIGNED')
    assert.deepEqual(services.calls.map(([name]) => name), [
      'persist', 'understand', 'classify', 'route', 'assign',
    ])
  })
}

test('OCR score below 75% enters human verification and cannot reach automatic routing', async () => {
  const services = createServices()
  const result = await processOcrResult(documentWithScore(74.99), services, 75)
  assert.equal(result.outcome, 'HUMAN_VERIFICATION_REQUIRED')
  assert.equal(result.document.humanVerificationRequired, true)
  assert.deepEqual(services.calls.map(([name]) => name), ['persist-and-queue'])
  assert.equal(services.calls[0][1].queueEntry.ocrThreshold, 75)
  assert.equal(services.calls[0][1].queueEntry.originalDocumentReference, 'private://document-1')
  assert.equal(services.calls[0][1].queueEntry.humanVerificationStatus, 'PENDING')
  assert.throws(
    () => assertAutomaticRoutingAllowed(result.document, 75),
    /blocked until human verification succeeds/,
  )
})

test('low OCR score verified by an authorized verifier continues processing', async () => {
  const services = createServices()
  const queued = await processOcrResult(documentWithScore(50), services, 90)
  const result = await resolveHumanVerification({
    document: queued.document,
    actor: { id: 'GO-1', role: 'GENERAL_OFFICER', permissions: ['HUMAN_VERIFY_OCR'] },
    decision: 'VERIFIED',
    note: 'Compared with the original.',
    services,
    threshold: 90,
  })
  assert.equal(result.outcome, 'ASSIGNED')
  assert.equal(result.document.ocrStatus, 'LOW_CONFIDENCE')
  assert.equal(result.document.humanVerificationStatus, 'VERIFIED')
  assert.deepEqual(services.calls.map(([name]) => name), [
    'persist-and-queue', 'audit-and-save', 'understand', 'classify', 'route', 'assign',
  ])
  assert.equal(services.calls[1][1].auditEvent.type, 'DOCUMENT_HUMAN_VERIFICATION_VERIFIED')
  assert.equal(services.calls[1][1].expectedHumanVerificationStatus, 'PENDING')
})

test('low OCR score rejected by a verifier uses the existing rejection workflow', async () => {
  const services = createServices()
  const queued = await processOcrResult(documentWithScore(50), services, 90)
  const result = await resolveHumanVerification({
    document: queued.document,
    actor: { id: 'HV-1', role: 'HUMAN_VERIFIER', permissions: ['HUMAN_VERIFY_OCR'] },
    decision: 'REJECTED',
    note: 'The source document could not be verified.',
    services,
    threshold: 90,
  })
  assert.equal(result.outcome, 'REJECTED_BY_HUMAN_VERIFICATION')
  assert.deepEqual(services.calls.map(([name]) => name), [
    'persist-and-queue', 'audit-and-save', 'existing-rejection',
  ])
  assert.equal(services.calls[1][1].auditEvent.type, 'DOCUMENT_HUMAN_VERIFICATION_REJECTED')
  assert.equal(services.calls[1][1].auditEvent.note, undefined)
})

test('unverified low-confidence documents cannot bypass the routing guard', () => {
  assert.throws(
    () => assertAutomaticRoutingAllowed({
      ocrScore: 50,
      humanVerificationRequired: true,
      humanVerificationStatus: 'PENDING',
    }, 90),
    /blocked until human verification succeeds/,
  )
})

test('human verification requires an authorized role and a rejection reason', async () => {
  const services = createServices()
  const queued = await processOcrResult(documentWithScore(50), services, 90)
  await assert.rejects(() => resolveHumanVerification({
    document: queued.document,
    actor: { id: 'OFF-1', role: 'OFFICER', permissions: ['HUMAN_VERIFY_OCR'] },
    decision: 'VERIFIED',
    services,
    threshold: 90,
  }), /authorized human verifier/)
  await assert.rejects(() => resolveHumanVerification({
    document: queued.document,
    actor: { id: 'GO-2', role: 'GENERAL_OFFICER' },
    decision: 'VERIFIED',
    services,
    threshold: 90,
  }), /authorized human verifier/)
  await assert.rejects(() => resolveHumanVerification({
    document: queued.document,
    actor: { id: 'GO-1', role: 'GENERAL_OFFICER', permissions: ['HUMAN_VERIFY_OCR'] },
    decision: 'REJECTED',
    services,
    threshold: 90,
  }), /rejection note is required/)
})

test('queue and private original access require human-verification authorization', async () => {
  const calls = []
  const services = {
    async listPendingHumanVerifications() { calls.push('list'); return [{ documentId: 'DOC-1' }] },
    async getPendingHumanVerification() {
      calls.push('get')
      return {
        documentId: 'DOC-1',
        applicationId: 'APP-1',
        originalDocumentReference: 'private://document-1',
        humanVerificationStatus: 'PENDING',
      }
    },
    async openPrivateOriginalDocument(request) { calls.push(request); return { stream: true } },
  }
  await assert.rejects(
    () => listHumanVerificationQueue({ id: 'OFF-1', role: 'OFFICER' }, services),
    /authorized human verifier/,
  )
  await assert.rejects(
    () => getHumanVerificationReview({
      documentId: 'DOC-1',
      actor: { id: 'GO-1', role: 'GENERAL_OFFICER' },
      services,
    }),
    /authorized human verifier/,
  )
  assert.deepEqual(calls, [])

  const actor = { id: 'HV-1', role: 'HUMAN_VERIFIER', permissions: ['HUMAN_VERIFY_OCR'] }
  assert.deepEqual(await listHumanVerificationQueue(actor, services), [{ documentId: 'DOC-1' }])
  const review = await getHumanVerificationReview({ documentId: 'DOC-1', actor, services })
  assert.deepEqual(review.originalDocument, { stream: true })
  assert.equal(calls[0], 'list')
  assert.equal(calls[1], 'get')
  assert.equal(calls[2].storageReference, 'private://document-1')
  assert.equal(calls[2].actor, actor)
})

test('OCR threshold defaults to 90 and can be configured safely', () => {
  assert.equal(getOcrThreshold({}), 90)
  assert.equal(getOcrThreshold({ OCR_THRESHOLD: '75' }), 75)
  assert.equal(getOcrThreshold({ OCR_THRESHOLD: '92' }), 92)
  assert.throws(() => getOcrThreshold({ OCR_THRESHOLD: '101' }), /between 0 and 100/)
})

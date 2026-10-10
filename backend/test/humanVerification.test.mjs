import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { signToken } from '../src/middleware/auth.mjs'
import Application from '../src/models/Application.mjs'
import AuditEvent from '../src/models/AuditEvent.mjs'
import Document from '../src/models/Document.mjs'
import User from '../src/models/User.mjs'
import { cleanupDocumentStorage } from '../src/services/documentService.mjs'
import { storeExtractedText, storeOriginal, readOriginal } from '../src/services/documentStorage.mjs'

const runId = `${process.pid}-${Date.now()}`
const testUsers = []
const testApplications = []
const testDocuments = []
const testEmails = []
let server
let baseUrl
let verifierToken
let applicantToken
let officerToken
let generalOfficerToken

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run verification integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for verification integration tests.')

  const passwordHash = await bcrypt.hash('TestPassword123!', 10)
  const [verifier, applicant, officer, generalOfficer] = await User.create([
    {
      email: `human-verifier-${runId}@example.test`,
      displayName: 'Human Verifier',
      passwordHash,
      role: 'HUMAN_VERIFIER',
      permissions: ['HUMAN_VERIFY_OCR'],
    },
    {
      email: `human-verification-applicant-${runId}@example.test`,
      displayName: 'Applicant',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
    },
    {
      email: `human-verification-officer-${runId}@example.test`,
      displayName: 'Officer',
      passwordHash,
      role: 'OFFICER',
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
    },
    {
      email: `human-verification-general-${runId}@example.test`,
      displayName: 'General Officer',
      passwordHash,
      role: 'GENERAL_OFFICER',
      permissions: ['APPLICATION_VIEW_ASSIGNED', 'HUMAN_VERIFY_OCR'],
    },
  ])
  testUsers.push(verifier, applicant, officer, generalOfficer)
  testEmails.push(verifier.email, applicant.email, officer.email, generalOfficer.email)
  verifierToken = signToken({ id: String(verifier._id), role: verifier.role, permissions: verifier.permissions })
  applicantToken = signToken({ id: String(applicant._id), role: applicant.role, permissions: applicant.permissions })
  officerToken = signToken({ id: String(officer._id), role: officer.role, permissions: officer.permissions })
  generalOfficerToken = signToken({
    id: String(generalOfficer._id),
    role: generalOfficer.role,
    permissions: generalOfficer.permissions,
  })

  server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  if (testDocuments.length) {
    const documents = await Document.find({ _id: { $in: testDocuments } })
      .select('+originalStorageId +extractedTextStorageId')
      .lean()
    for (const document of documents) await cleanupDocumentStorage(document)
    await Document.deleteMany({ _id: { $in: testDocuments } })
  }
  if (testApplications.length) await Application.deleteMany({ _id: { $in: testApplications } })
  if (testEmails.length) await User.deleteMany({ email: { $in: testEmails } })
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

async function createVerificationDocument({
  ocrStatus = 'LOW_CONFIDENCE',
  verificationStatus = 'PENDING',
  humanVerificationRequired = true,
  text = 'Applicant name: Original Name\nAddress: 10 Main Street',
} = {}) {
  const applicant = testUsers[1]
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Residence certificate',
    applicationData: {
      title: `Verification test ${testApplications.length + 1}`,
      applicantName: 'Test Applicant',
      contactEmail: applicant.email,
      details: 'Verification integration test application.',
    },
  })
  testApplications.push(application._id)
  const originalBuffer = Buffer.from('private original government document fixture')
  const originalStorageId = await storeOriginal(originalBuffer, '.png')
  const extractedTextStorageId = await storeExtractedText(randomUUID(), text)
  const document = await Document.create({
    applicationId: application._id,
    applicantId: applicant._id,
    originalFilename: 'identity-document.png',
    documentType: 'Proof of identity',
    mimeType: 'image/png',
    fileSize: originalBuffer.length,
    originalStorageId,
    extractedTextStorageId,
    ocrStatus,
    ocrConfidence: 72,
    ocrThreshold: 90,
    humanVerificationRequired,
    humanVerificationStatus: verificationStatus,
  })
  testDocuments.push(document._id)
  return { application, document, originalBuffer }
}

async function request(path, token, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
}

test('pending queue includes only low-confidence documents awaiting verification', async () => {
  const pending = await createVerificationDocument()
  const completed = await createVerificationDocument({ ocrStatus: 'COMPLETED' })
  const resolved = await createVerificationDocument({ verificationStatus: 'VERIFIED' })

  const response = await request('/api/human-verification', verifierToken)
  const { queue } = await response.json()

  assert.equal(response.status, 200)
  assert.ok(queue.some((item) => item.id === String(pending.document._id)))
  assert.ok(!queue.some((item) => [completed.document, resolved.document].some((doc) => item.id === String(doc._id))))
  assert.equal(queue.find((item) => item.id === String(pending.document._id)).applicationTitle, pending.application.applicationData.title)
})

test('verification queue and decision APIs allow authorized verifier roles and require permission', async () => {
  const { document } = await createVerificationDocument()
  assert.equal((await request('/api/human-verification')).status, 401)
  assert.equal((await request('/api/human-verification', applicantToken)).status, 403)
  assert.equal((await request('/api/human-verification', officerToken)).status, 403)
  assert.equal((await request('/api/human-verification', generalOfficerToken)).status, 200)
  assert.equal((await request(`/api/human-verification/${document._id}`, generalOfficerToken)).status, 200)

  const deniedDecision = await request(`/api/human-verification/${document._id}/decision`, applicantToken, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'VERIFIED',
      correctedFields: [{ name: 'Applicant name', value: 'Verified name' }],
    }),
  })
  assert.equal(deniedDecision.status, 403)

  const noPermissionUser = await User.create({
    email: `human-verifier-no-permission-${runId}@example.test`,
    displayName: 'Verifier without permission',
    passwordHash: await bcrypt.hash('TestPassword123!', 10),
    role: 'HUMAN_VERIFIER',
    permissions: [],
  })
  testUsers.push(noPermissionUser)
  testEmails.push(noPermissionUser.email)
  const noPermissionToken = signToken({
    id: String(noPermissionUser._id),
    role: noPermissionUser.role,
    permissions: noPermissionUser.permissions,
  })
  assert.equal((await request('/api/human-verification', noPermissionToken)).status, 403)
})

test('Human Verifier can retrieve OCR evidence and access the original only through the protected endpoint', async () => {
  const { document, originalBuffer } = await createVerificationDocument()
  const reviewResponse = await request(`/api/human-verification/${document._id}`, verifierToken)
  const { review } = await reviewResponse.json()
  assert.equal(reviewResponse.status, 200)
  assert.equal(review.ocrScore, 72)
  assert.equal(review.ocrThreshold, 90)
  assert.equal(review.extractedText, 'Applicant name: Original Name\nAddress: 10 Main Street')
  assert.equal('originalStorageId' in review, false)
  assert.equal('extractedTextStorageId' in review, false)

  assert.equal((await request(`/api/documents/${document._id}`)).status, 401)
  const applicantOriginal = await request(`/api/documents/${document._id}`, applicantToken)
  assert.equal(applicantOriginal.status, 200)
  assert.deepEqual(Buffer.from(await applicantOriginal.arrayBuffer()), originalBuffer)
  const generalOfficerOriginal = await request(`/api/documents/${document._id}`, generalOfficerToken)
  assert.equal(generalOfficerOriginal.status, 200)
  assert.deepEqual(Buffer.from(await generalOfficerOriginal.arrayBuffer()), originalBuffer)

  const originalResponse = await request(`/api/documents/${document._id}`, verifierToken)
  assert.equal(originalResponse.status, 200)
  assert.deepEqual(Buffer.from(await originalResponse.arrayBuffer()), originalBuffer)
})

test('approval persists corrected fields, verifier identity, decision time, and retains the original', async () => {
  const { document, originalBuffer } = await createVerificationDocument()
  const verifier = testUsers[0]
  const correctedFields = [
    { name: 'Applicant name', value: 'Corrected Name' },
    { name: 'Address', value: '22 New Road' },
  ]
  const response = await request(`/api/human-verification/${document._id}/decision`, verifierToken, {
    method: 'POST',
    body: JSON.stringify({ decision: 'VERIFIED', correctedFields, note: 'Compared with source.' }),
  })
  const { result } = await response.json()

  assert.equal(response.status, 200)
  assert.equal(result.humanVerificationStatus, 'VERIFIED')
  const stored = await Document.findById(document._id)
    .select('+correctedExtractedData +humanVerificationNote +originalStorageId')
  assert.equal(stored.humanVerificationDecision, 'VERIFIED')
  assert.equal(String(stored.humanVerifiedBy), String(verifier._id))
  assert.ok(stored.humanVerifiedAt instanceof Date)
  assert.equal(stored.humanVerificationNote, 'Compared with source.')
  assert.deepEqual(stored.correctedExtractedData.map(({ name, value }) => ({ name, value })), correctedFields)
  assert.deepEqual(await readOriginal(stored.originalStorageId, '.png'), originalBuffer)
  assert.equal((await request(`/api/human-verification/${document._id}`, verifierToken)).status, 404)
  const auditEvent = await AuditEvent.findOne({
    documentId: document._id,
    action: 'HUMAN_VERIFICATION_DECISION',
  }).lean()
  assert.equal(auditEvent.previousStatus, 'PENDING')
  assert.equal(auditEvent.newStatus, 'VERIFIED')
  assert.equal(String(auditEvent.actorId), String(verifier._id))
  assert.equal(auditEvent.actorRole, 'HUMAN_VERIFIER')
})

test('rejection persists verifier and reason without deleting the original document', async () => {
  const { document, originalBuffer } = await createVerificationDocument()
  const response = await request(`/api/human-verification/${document._id}/decision`, verifierToken, {
    method: 'POST',
    body: JSON.stringify({ decision: 'REJECTED', note: 'The document is illegible.' }),
  })
  assert.equal(response.status, 200)

  const stored = await Document.findById(document._id)
    .select('+humanVerificationNote +originalStorageId')
  assert.equal(stored.humanVerificationStatus, 'REJECTED')
  assert.equal(stored.humanVerificationDecision, 'REJECTED')
  assert.equal(String(stored.humanVerifiedBy), String(testUsers[0]._id))
  assert.ok(stored.humanVerifiedAt instanceof Date)
  assert.equal(stored.humanVerificationNote, 'The document is illegible.')
  assert.deepEqual(await readOriginal(stored.originalStorageId, '.png'), originalBuffer)
})

test('verification decisions validate corrections and reject stale decisions', async () => {
  const { document } = await createVerificationDocument()
  const invalidCorrection = await request(`/api/human-verification/${document._id}/decision`, verifierToken, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'VERIFIED',
      correctedFields: [{ name: '', value: 'invalid' }],
    }),
  })
  assert.equal(invalidCorrection.status, 400)

  const rejectionWithoutReason = await request(`/api/human-verification/${document._id}/decision`, verifierToken, {
    method: 'POST',
    body: JSON.stringify({ decision: 'REJECTED', note: '   ' }),
  })
  assert.equal(rejectionWithoutReason.status, 400)

  const firstDecision = await request(`/api/human-verification/${document._id}/decision`, verifierToken, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'VERIFIED',
      correctedFields: [{ name: 'Applicant name', value: 'Verified name' }],
    }),
  })
  assert.equal(firstDecision.status, 200)
  const repeatedDecision = await request(`/api/human-verification/${document._id}/decision`, verifierToken, {
    method: 'POST',
    body: JSON.stringify({ decision: 'REJECTED', note: 'Changed my mind.' }),
  })
  assert.equal(repeatedDecision.status, 404)
})

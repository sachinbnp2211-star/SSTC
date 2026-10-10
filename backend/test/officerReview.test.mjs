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
import { readOriginal, storeExtractedText, storeOriginal } from '../src/services/documentStorage.mjs'

const runId = `${process.pid}-${Date.now()}`
const createdUsers = []
const createdEmails = []
const createdApplications = []
const createdDocuments = []
let server
let baseUrl
let officer
let officerToken
let sameDepartmentOfficer
let sameDepartmentOfficerToken
let otherDepartmentToken
let applicantToken
let unprivilegedOfficerToken
let verifier

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run Officer review integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for Officer review integration tests.')

  const departmentA = new mongoose.Types.ObjectId()
  const departmentB = new mongoose.Types.ObjectId()
  const passwordHash = await bcrypt.hash('TestPassword123!', 10)
  const [
    createdOfficer,
    otherDepartmentOfficer,
    applicant,
    unprivilegedOfficer,
    createdVerifier,
    createdSameDepartmentOfficer,
  ] = await User.create([
    {
      email: `officer-review-${runId}@example.test`,
      displayName: 'Department A Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(departmentA),
      governmentOfficerId: `OFF-${runId}`,
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
    },
    {
      email: `officer-review-other-${runId}@example.test`,
      displayName: 'Department B Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(departmentB),
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
    },
    {
      email: `officer-review-applicant-${runId}@example.test`,
      displayName: 'Officer Review Applicant',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
    },
    {
      email: `officer-review-no-permission-${runId}@example.test`,
      displayName: 'Unprivileged Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(departmentA),
      permissions: [],
    },
    {
      email: `officer-review-verifier-${runId}@example.test`,
      displayName: 'Review Human Verifier',
      passwordHash,
      role: 'HUMAN_VERIFIER',
      permissions: ['HUMAN_VERIFY_OCR'],
    },
    {
      email: `officer-review-same-department-${runId}@example.test`,
      displayName: 'Second Department A Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(departmentA),
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
    },
  ])
  officer = createdOfficer
  sameDepartmentOfficer = createdSameDepartmentOfficer
  verifier = createdVerifier
  createdUsers.push(createdOfficer, otherDepartmentOfficer, applicant, unprivilegedOfficer, createdVerifier)
  createdEmails.push(...createdUsers.map((user) => user.email))
  officerToken = signToken({ id: String(createdOfficer._id), role: createdOfficer.role, permissions: createdOfficer.permissions })
  sameDepartmentOfficerToken = signToken({
    id: String(createdSameDepartmentOfficer._id),
    role: createdSameDepartmentOfficer.role,
    permissions: createdSameDepartmentOfficer.permissions,
  })
  otherDepartmentToken = signToken({
    id: String(otherDepartmentOfficer._id),
    role: otherDepartmentOfficer.role,
    permissions: otherDepartmentOfficer.permissions,
  })
  applicantToken = signToken({ id: String(applicant._id), role: applicant.role, permissions: applicant.permissions })
  unprivilegedOfficerToken = signToken({
    id: String(unprivilegedOfficer._id),
    role: unprivilegedOfficer.role,
    permissions: unprivilegedOfficer.permissions,
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
  if (createdDocuments.length) {
    const documents = await Document.find({ _id: { $in: createdDocuments } })
      .select('+originalStorageId +extractedTextStorageId')
      .lean()
    for (const document of documents) await cleanupDocumentStorage(document)
    await Document.deleteMany({ _id: { $in: createdDocuments } })
  }
  if (createdApplications.length) await Application.deleteMany({ _id: { $in: createdApplications } })
  if (createdEmails.length) await User.deleteMany({ email: { $in: createdEmails } })
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

async function createApplication({
  departmentId = officer.departmentId,
  assignedOfficerId = officer._id,
  status = 'ASSIGNED',
  withVerifiedDocument = false,
} = {}) {
  const applicant = createdUsers.find((user) => user.role === 'APPLICANT')
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Residence certificate',
    applicationData: {
      title: `Officer review ${createdApplications.length + 1}`,
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Review integration test application details.',
    },
    departmentId,
    assignedOfficerId,
    status,
    submittedAt: new Date(),
  })
  createdApplications.push(application._id)

  let originalBuffer
  let document
  if (withVerifiedDocument) {
    originalBuffer = Buffer.from('authorized original document bytes')
    const originalStorageId = await storeOriginal(originalBuffer, '.png')
    const extractedTextStorageId = await storeExtractedText(
      randomUUID(),
      'Applicant name: Original OCR value\nAddress: 10 Main Street',
    )
    document = await Document.create({
      applicationId: application._id,
      applicantId: applicant._id,
      originalFilename: 'residence-proof.png',
      documentType: 'Proof of residence',
      mimeType: 'image/png',
      fileSize: originalBuffer.length,
      originalStorageId,
      extractedTextStorageId,
      ocrStatus: 'LOW_CONFIDENCE',
      ocrConfidence: 78,
      ocrThreshold: 90,
      humanVerificationRequired: true,
      humanVerificationStatus: 'VERIFIED',
      humanVerificationDecision: 'VERIFIED',
      humanVerifiedBy: verifier._id,
      humanVerifiedAt: new Date(),
      humanVerificationNote: 'Address corrected from the original.',
      correctedExtractedData: [
        { name: 'Applicant name', value: applicant.displayName },
        { name: 'Address', value: '22 New Street' },
      ],
    })
    createdDocuments.push(document._id)
  }
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

async function startReview(applicationId, token = officerToken) {
  return request(`/api/officer/applications/${applicationId}/start-review`, token, { method: 'POST' })
}

async function makeDecision(applicationId, decision, reason, token = officerToken, officerId) {
  return request(`/api/officer/applications/${applicationId}/decision`, token, {
    method: 'POST',
    body: JSON.stringify({ decision, reason, officerId }),
  })
}

test('Officer queue and review scope include only applications assigned to the authenticated Officer', async () => {
  const inScope = await createApplication({ status: 'ASSIGNED' })
  const underReview = await createApplication({ status: 'UNDER_REVIEW' })
  const assignedToPeer = await createApplication({
    assignedOfficerId: sameDepartmentOfficer._id,
  })
  const outOfScope = await createApplication({
    departmentId: createdUsers.find((user) => user.displayName === 'Department B Officer').departmentId,
    assignedOfficerId: createdUsers.find((user) => user.displayName === 'Department B Officer')._id,
  })

  const response = await request('/api/officer/applications', officerToken)
  const { applications } = await response.json()
  assert.equal(response.status, 200)
  assert.ok(applications.some((application) => application.id === String(inScope.application._id)))
  assert.ok(applications.some((application) => application.id === String(underReview.application._id)))
  assert.ok(!applications.some((application) => application.id === String(assignedToPeer.application._id)))
  assert.ok(!applications.some((application) => application.id === String(outOfScope.application._id)))

  const peerResponse = await request('/api/officer/applications', sameDepartmentOfficerToken)
  const peerApplications = (await peerResponse.json()).applications
  assert.equal(peerResponse.status, 200)
  assert.deepEqual(peerApplications.map((application) => application.id), [
    String(assignedToPeer.application._id),
  ])
  assert.equal((await request(
    `/api/officer/applications/${assignedToPeer.application._id}`,
    officerToken,
  )).status, 404)
  assert.equal((await startReview(assignedToPeer.application._id)).status, 404)

  const otherDepartment = await request('/api/officer/applications', otherDepartmentToken)
  assert.equal(otherDepartment.status, 200)
  assert.ok((await otherDepartment.json()).applications.some(
    (application) => application.id === String(outOfScope.application._id),
  ))
})

test('Officer APIs require authentication, OFFICER role, and the existing permission', async () => {
  const { application } = await createApplication()
  assert.equal((await request('/api/officer/applications')).status, 401)
  assert.equal((await request('/api/officer/applications', applicantToken)).status, 403)
  assert.equal((await request('/api/officer/applications', unprivilegedOfficerToken)).status, 403)
  assert.equal((await request('/api/officer/applications', signToken({
    id: String(verifier._id),
    role: verifier.role,
    permissions: verifier.permissions,
  }))).status, 403)
  assert.equal((await request(`/api/officer/applications/${application._id}`, otherDepartmentToken)).status, 404)
})

test('Officer can retrieve applicant, document, OCR, and Human Verification information in scope', async () => {
  const { application, document, originalBuffer } = await createApplication({ withVerifiedDocument: true })
  const response = await request(`/api/officer/applications/${application._id}`, officerToken)
  const { application: result } = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.applicant.name, 'Officer Review Applicant')
  assert.equal(result.applicant.email, 'officer-review-applicant-' + runId + '@example.test')
  assert.equal(result.documents.length, 1)
  assert.equal(result.documents[0].extractedText, 'Applicant name: Original OCR value\nAddress: 10 Main Street')
  assert.equal(result.documents[0].humanVerificationStatus, 'VERIFIED')
  assert.equal(result.documents[0].humanVerificationDecision, 'VERIFIED')
  assert.equal(result.documents[0].humanVerifiedBy, 'Review Human Verifier')
  assert.equal(result.documents[0].humanVerificationNote, 'Address corrected from the original.')
  assert.deepEqual(result.documents[0].correctedExtractedData, [
    { name: 'Applicant name', value: 'Officer Review Applicant' },
    { name: 'Address', value: '22 New Street' },
  ])

  const privateOriginal = await request(`/api/documents/${document._id}`, officerToken)
  assert.equal(privateOriginal.status, 200)
  assert.deepEqual(Buffer.from(await privateOriginal.arrayBuffer()), originalBuffer)
  assert.deepEqual(await readOriginal(
    (await Document.findById(document._id).select('+originalStorageId')).originalStorageId,
    '.png',
  ), originalBuffer)

  const sameDepartmentPeerOriginal = await request(
    `/api/documents/${document._id}`,
    sameDepartmentOfficerToken,
  )
  assert.equal(sameDepartmentPeerOriginal.status, 404)

  const foreignOriginal = await request(`/api/documents/${document._id}`, otherDepartmentToken)
  assert.equal(foreignOriginal.status, 404)
})

test('Start Review persists UNDER_REVIEW, authenticated Officer ID, and timestamp', async () => {
  const { application } = await createApplication()
  const response = await startReview(application._id)
  const { application: result } = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.status, 'UNDER_REVIEW')
  assert.equal(result.officerReview.startedBy, String(officer._id))
  assert.ok(result.officerReview.startedAt)

  const stored = await Application.findById(application._id)
  assert.equal(stored.status, 'UNDER_REVIEW')
  assert.equal(String(stored.officerReview.startedBy), String(officer._id))
  assert.ok(stored.officerReview.startedAt instanceof Date)
})

test('Approve persists APPROVED status, decision Officer ID, timestamp, and optional note', async () => {
  const { application } = await createApplication({ status: 'UNDER_REVIEW' })
  const response = await makeDecision(application._id, 'APPROVED', 'Requirements satisfied.')
  const { application: result } = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.status, 'APPROVED')
  assert.equal(result.officerReview.decision, 'APPROVED')
  assert.equal(result.officerReview.decidedBy, String(officer._id))
  assert.ok(result.officerReview.decidedAt)

  const stored = await Application.findById(application._id)
  assert.equal(stored.status, 'APPROVED')
  assert.equal(String(stored.officerReview.decidedBy), String(officer._id))
  assert.equal(stored.officerReview.reason, 'Requirements satisfied.')
  assert.ok(stored.officerReview.decidedAt instanceof Date)
})

test('Reject and escalation require and persist reasons with the authenticated Officer identity', async () => {
  const rejected = await createApplication({ status: 'UNDER_REVIEW' })
  const unauthenticatedDecision = await request(
    `/api/officer/applications/${rejected.application._id}/decision`,
    null,
    { method: 'POST', body: JSON.stringify({ decision: 'REJECTED', reason: 'Unauthenticated rejection.' }) },
  )
  assert.equal(unauthenticatedDecision.status, 401)
  const applicantDecision = await request(
    `/api/officer/applications/${rejected.application._id}/decision`,
    applicantToken,
    { method: 'POST', body: JSON.stringify({ decision: 'REJECTED', reason: 'Applicant rejection.' }) },
  )
  assert.equal(applicantDecision.status, 403)
  const peerDecision = await request(
    `/api/officer/applications/${rejected.application._id}/decision`,
    sameDepartmentOfficerToken,
    { method: 'POST', body: JSON.stringify({ decision: 'REJECTED', reason: 'Peer rejection.' }) },
  )
  assert.equal(peerDecision.status, 404)
  const missingRejectionReason = await makeDecision(rejected.application._id, 'REJECTED', '  ')
  assert.equal(missingRejectionReason.status, 400)
  const rejectResponse = await makeDecision(rejected.application._id, 'REJECTED', 'Required document is invalid.')
  assert.equal(rejectResponse.status, 200)
  const rejectedRecord = await Application.findById(rejected.application._id)
  assert.equal(rejectedRecord.status, 'REJECTED')
  assert.equal(rejectedRecord.officerReview.reason, 'Required document is invalid.')
  assert.equal(String(rejectedRecord.officerReview.decidedBy), String(officer._id))
  assert.ok(rejectedRecord.officerReview.decidedAt)
  const rejectedQueue = await request('/api/officer/applications', officerToken)
  assert.ok(!(await rejectedQueue.json()).applications.some(
    (application) => application.id === String(rejected.application._id),
  ))
  const applicantViewResponse = await request(
    `/api/applications/${rejected.application._id}`,
    applicantToken,
  )
  assert.equal(applicantViewResponse.status, 200)
  const applicantView = (await applicantViewResponse.json()).application
  assert.equal(applicantView.status, 'REJECTED')
  assert.equal(applicantView.rejectionReason, 'Required document is invalid.')
  assert.equal(new Date(applicantView.rejectedAt).toISOString(), rejectedRecord.officerReview.decidedAt.toISOString())
  assert.equal('officerReview' in applicantView, false)
  assert.equal((await request(
    `/api/applications/${rejected.application._id}`,
    applicantToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'REJECTED', rejectionReason: 'Applicant-authored forgery.' }),
    },
  )).status, 404)

  const escalated = await createApplication({ status: 'UNDER_REVIEW' })
  const missingEscalationReason = await makeDecision(escalated.application._id, 'ESCALATED', '')
  assert.equal(missingEscalationReason.status, 400)
  const escalationResponse = await makeDecision(escalated.application._id, 'ESCALATED', 'Potential identity mismatch.')
  assert.equal(escalationResponse.status, 200)
  const escalatedRecord = await Application.findById(escalated.application._id)
  assert.equal(escalatedRecord.status, 'ESCALATED')
  assert.equal(escalatedRecord.officerReview.reason, 'Potential identity mismatch.')
  assert.equal(String(escalatedRecord.officerReview.decidedBy), String(officer._id))
  assert.ok(escalatedRecord.officerReview.decidedAt)
  const escalationEvent = await AuditEvent.findOne({
    applicationId: escalated.application._id,
    action: 'OFFICER_ESCALATED_APPLICATION',
  }).lean()
  assert.equal(escalationEvent.previousStatus, 'UNDER_REVIEW')
  assert.equal(escalationEvent.newStatus, 'ESCALATED')
  assert.equal(escalationEvent.reason, 'Potential identity mismatch.')
  assert.equal(String(escalationEvent.actorId), String(officer._id))
  assert.equal(escalationEvent.actorRole, 'OFFICER')
})

test('Officer cannot start or decide outside department scope or before documents are ready', async () => {
  const outside = await createApplication({
    status: 'UNDER_REVIEW',
    departmentId: createdUsers.find((user) => user.displayName === 'Department B Officer').departmentId,
  })
  assert.equal((await makeDecision(outside.application._id, 'APPROVED', '')).status, 404)
  assert.equal((await startReview(outside.application._id)).status, 404)

  const blocked = await createApplication()
  const applicant = createdUsers.find((user) => user.role === 'APPLICANT')
  await Document.create({
    applicationId: blocked.application._id,
    applicantId: applicant._id,
    originalFilename: 'pending.png',
    documentType: 'Supporting document',
    mimeType: 'image/png',
    fileSize: 1,
    originalStorageId: await storeOriginal(Buffer.from('x'), '.png'),
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 70,
    ocrThreshold: 90,
    humanVerificationRequired: true,
    humanVerificationStatus: 'PENDING',
  }).then((document) => createdDocuments.push(document._id))
  assert.equal((await request(`/api/officer/applications/${blocked.application._id}`, officerToken)).status, 409)
  assert.equal((await startReview(blocked.application._id)).status, 409)
})

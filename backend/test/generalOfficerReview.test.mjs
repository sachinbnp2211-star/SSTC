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
let generalOfficer
let generalOfficerToken
let noPermissionToken
let applicantToken
let officerToken
let applicant

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run General Officer review integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for General Officer review integration tests.')

  const passwordHash = await bcrypt.hash('TestPassword123!', 10)
  const [createdGeneralOfficer, unprivilegedGeneralOfficer, createdApplicant, createdOfficer] = await User.create([
    {
      email: `general-review-${runId}@example.test`,
      displayName: 'General Review Officer',
      passwordHash,
      role: 'GENERAL_OFFICER',
      permissions: ['APPLICATION_VIEW_ASSIGNED', 'HUMAN_VERIFY_OCR'],
    },
    {
      email: `general-review-no-permission-${runId}@example.test`,
      displayName: 'Unprivileged General Officer',
      passwordHash,
      role: 'GENERAL_OFFICER',
      permissions: [],
    },
    {
      email: `general-review-applicant-${runId}@example.test`,
      displayName: 'General Review Applicant',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
    },
    {
      email: `general-review-officer-${runId}@example.test`,
      displayName: 'Department Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(new mongoose.Types.ObjectId()),
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
    },
  ])
  generalOfficer = createdGeneralOfficer
  applicant = createdApplicant
  createdUsers.push(createdGeneralOfficer, unprivilegedGeneralOfficer, createdApplicant, createdOfficer)
  createdEmails.push(...createdUsers.map((user) => user.email))
  generalOfficerToken = signToken({
    id: String(createdGeneralOfficer._id),
    role: createdGeneralOfficer.role,
    permissions: createdGeneralOfficer.permissions,
  })
  noPermissionToken = signToken({
    id: String(unprivilegedGeneralOfficer._id),
    role: unprivilegedGeneralOfficer.role,
    permissions: unprivilegedGeneralOfficer.permissions,
  })
  applicantToken = signToken({ id: String(createdApplicant._id), role: createdApplicant.role, permissions: createdApplicant.permissions })
  officerToken = signToken({ id: String(createdOfficer._id), role: createdOfficer.role, permissions: createdOfficer.permissions })

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

async function createApplication({ status = 'ESCALATED', withDocument = false } = {}) {
  const officer = createdUsers.find((user) => user.role === 'OFFICER')
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Residence certificate',
    applicationData: {
      title: `General review ${createdApplications.length + 1}`,
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'General Officer integration test application details.',
    },
    departmentId: officer.departmentId,
    status,
    submittedAt: new Date(),
    officerReview: {
      startedBy: officer._id,
      startedAt: new Date(Date.now() - 120000),
      decision: 'ESCALATED',
      decidedBy: officer._id,
      decidedAt: new Date(Date.now() - 60000),
      reason: 'Officer escalation requires a final review.',
      notes: [{
        officerId: officer._id,
        action: 'ESCALATED',
        note: 'Officer escalation requires a final review.',
        at: new Date(Date.now() - 60000),
      }],
    },
  })
  createdApplications.push(application._id)

  let document
  let originalBuffer
  if (withDocument) {
    originalBuffer = Buffer.from('private escalated application document')
    const originalStorageId = await storeOriginal(originalBuffer, '.png')
    const extractedTextStorageId = await storeExtractedText(
      randomUUID(),
      'Applicant name: General Review Applicant\nAddress: 10 Main Street',
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
      ocrStatus: 'COMPLETED',
      ocrConfidence: 97,
      ocrThreshold: 90,
      humanVerificationRequired: false,
      humanVerificationStatus: null,
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

async function decide(applicationId, decision, reason, token = generalOfficerToken, generalOfficerId) {
  return request(`/api/general-officer/applications/${applicationId}/decision`, token, {
    method: 'POST',
    body: JSON.stringify({ decision, reason, generalOfficerId }),
  })
}

test('General Officer queue returns only MongoDB-backed escalated applications', async () => {
  const escalated = await createApplication()
  const resolved = await createApplication({ status: 'APPROVED' })
  const response = await request('/api/general-officer/applications', generalOfficerToken)
  const { applications } = await response.json()
  assert.equal(response.status, 200)
  assert.ok(applications.some((record) => record.id === String(escalated.application._id)))
  assert.ok(!applications.some((record) => record.id === String(resolved.application._id)))
  assert.ok(applications.every((record) => record.status === 'ESCALATED'))
})

test('General Officer tracking searches own submissions using OCR text without exposing it', async () => {
  const ownSubmission = await Application.create({
    applicantId: generalOfficer._id,
    applicationType: 'Income Certificate',
    applicationData: {
      title: `Dashboard search ${runId}`,
      applicantName: generalOfficer.displayName,
      contactEmail: generalOfficer.email,
      details: 'Submitted through the General Officer workspace.',
    },
    status: 'WAITING_FOR_OFFICER_ASSIGNMENT',
    submittedAt: new Date(),
  })
  createdApplications.push(ownSubmission._id)
  const originalBuffer = Buffer.from('private dashboard search document')
  const originalStorageId = await storeOriginal(originalBuffer, '.png')
  const extractedTextStorageId = await storeExtractedText(
    randomUUID(),
    'Official document number: GO-OCR-APP-92841',
  )
  const document = await Document.create({
    applicationId: ownSubmission._id,
    applicantId: generalOfficer._id,
    originalFilename: 'general-officer-submission.png',
    documentType: 'Income Certificate',
    mimeType: 'image/png',
    fileSize: originalBuffer.length,
    originalStorageId,
    extractedTextStorageId,
    ocrStatus: 'COMPLETED',
    ocrConfidence: 97,
    ocrThreshold: 90,
  })
  createdDocuments.push(document._id)

  const ownSearch = await request(
    '/api/general-officer/dashboard?search=GO-OCR-APP-92841',
    generalOfficerToken,
  )
  const ownDashboard = await ownSearch.json()
  assert.equal(ownSearch.status, 200)
  assert.deepEqual(ownDashboard.submissions.map(({ id }) => id), [String(ownSubmission._id)])
  assert.equal(ownDashboard.submissions[0].documents[0].extractedText, undefined)
  assert.equal(ownDashboard.escalatedCases, undefined)

  const unrelatedOcrSearch = await request(
    '/api/general-officer/dashboard?search=10%20Main%20Street',
    generalOfficerToken,
  )
  const trackingResult = await unrelatedOcrSearch.json()
  assert.equal(unrelatedOcrSearch.status, 200)
  assert.deepEqual(trackingResult.submissions, [])

  assert.equal((await request('/api/general-officer/dashboard?search=too-long', applicantToken)).status, 403)
  assert.equal((await request(`/api/general-officer/dashboard?search=${'a'.repeat(161)}`, generalOfficerToken)).status, 400)
})

test('General Officer APIs enforce authentication, role, and permission', async () => {
  await createApplication()
  assert.equal((await request('/api/general-officer/applications')).status, 401)
  assert.equal((await request('/api/general-officer/applications', applicantToken)).status, 403)
  assert.equal((await request('/api/general-officer/applications', officerToken)).status, 403)
  assert.equal((await request('/api/general-officer/applications', noPermissionToken)).status, 403)
})

test('General Officer can securely retrieve escalated application evidence and original documents', async () => {
  const { application, document, originalBuffer } = await createApplication({ withDocument: true })
  const detailResponse = await request(
    `/api/general-officer/applications/${application._id}`,
    generalOfficerToken,
  )
  const { application: detail } = await detailResponse.json()
  assert.equal(detailResponse.status, 200)
  assert.equal(detail.applicant.name, applicant.displayName)
  assert.equal(detail.documents[0].extractedText, 'Applicant name: General Review Applicant\nAddress: 10 Main Street')
  assert.equal(detail.officerReview.reason, 'Officer escalation requires a final review.')
  assert.equal(detail.escalation.originatingOfficer, 'Department Officer')

  const privateOriginal = await request(`/api/documents/${document._id}`, generalOfficerToken)
  assert.equal(privateOriginal.status, 200)
  assert.deepEqual(Buffer.from(await privateOriginal.arrayBuffer()), originalBuffer)
  const storedDocument = await Document.findById(document._id).select('+originalStorageId')
  assert.deepEqual(await readOriginal(storedDocument.originalStorageId, '.png'), originalBuffer)

  assert.equal((await request(`/api/general-officer/applications/${application._id}`, officerToken)).status, 403)
  assert.equal((await request(`/api/documents/${document._id}`, officerToken)).status, 404)
})

test('General Officer approval persists final status, identity, and decision timestamp', async () => {
  const { application } = await createApplication()
  const response = await decide(
    application._id,
    'APPROVED',
    'Approved after escalation review.',
    generalOfficerToken,
    applicant._id,
  )
  const { application: result } = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.status, 'APPROVED')
  assert.equal(result.generalOfficerReview.decision, 'APPROVED')
  assert.equal(result.generalOfficerReview.decidedBy, String(generalOfficer._id))
  assert.ok(result.generalOfficerReview.decidedAt)

  const stored = await Application.findById(application._id)
  assert.equal(stored.status, 'APPROVED')
  assert.equal(String(stored.generalOfficerReview.decidedBy), String(generalOfficer._id))
  assert.equal(stored.generalOfficerReview.reason, 'Approved after escalation review.')
  assert.ok(stored.generalOfficerReview.decidedAt instanceof Date)
  const auditEvent = await AuditEvent.findOne({
    applicationId: application._id,
    action: 'GENERAL_OFFICER_APPROVED_APPLICATION',
  }).lean()
  assert.equal(auditEvent.previousStatus, 'ESCALATED')
  assert.equal(auditEvent.newStatus, 'APPROVED')
  assert.equal(String(auditEvent.actorId), String(generalOfficer._id))
  assert.equal(auditEvent.actorRole, 'GENERAL_OFFICER')
})

test('General Officer rejection requires and persists a reason', async () => {
  const { application } = await createApplication()
  assert.equal((await decide(application._id, 'REJECTED', '  ')).status, 400)
  const response = await decide(application._id, 'REJECTED', 'The supporting evidence is insufficient.')
  const { application: result } = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.status, 'REJECTED')
  const stored = await Application.findById(application._id)
  assert.equal(stored.generalOfficerReview.decision, 'REJECTED')
  assert.equal(stored.generalOfficerReview.reason, 'The supporting evidence is insufficient.')
  assert.equal(String(stored.generalOfficerReview.decidedBy), String(generalOfficer._id))
  assert.ok(stored.generalOfficerReview.decidedAt instanceof Date)
})

test('General Officer rejects invalid, stale, and already-resolved decisions', async () => {
  const { application } = await createApplication({ status: 'UNDER_REVIEW' })
  assert.equal((await decide(application._id, 'APPROVED', '')).status, 404)
  assert.equal((await decide(application._id, 'ESCALATED', 'Invalid transition.')).status, 400)

  const escalated = await createApplication()
  assert.equal((await decide(escalated.application._id, 'APPROVED', '')).status, 200)
  assert.equal((await decide(escalated.application._id, 'REJECTED', 'Late decision.')).status, 404)
  assert.equal((await request(`/api/general-officer/applications/${escalated.application._id}`, generalOfficerToken)).status, 404)
})

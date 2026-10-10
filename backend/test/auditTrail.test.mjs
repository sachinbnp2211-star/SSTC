import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
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
import { advanceApplicationToOfficerReview, recordApplicationStatusTransition } from '../src/services/applicationLifecycleService.mjs'

const runId = `${process.pid}-${Date.now()}`
const createdUsers = []
const createdApplications = []
const createdDocuments = []
let server
let baseUrl
let applicant
let applicantToken
let verifier

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run audit trail integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for audit trail integration tests.')

  const passwordHash = await bcrypt.hash('TestPassword123!', 10)
  ;[applicant, verifier] = await User.create([
    {
      email: `audit-applicant-${runId}@example.test`,
      displayName: 'Audit Applicant',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
    },
    {
      email: `audit-verifier-${runId}@example.test`,
      displayName: 'Audit Verifier',
      passwordHash,
      role: 'HUMAN_VERIFIER',
      permissions: ['HUMAN_VERIFY_OCR'],
    },
  ])
  createdUsers.push(applicant, verifier)
  applicantToken = signToken({
    id: String(applicant._id),
    role: applicant.role,
    permissions: applicant.permissions,
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
  if (createdDocuments.length) await Document.deleteMany({ _id: { $in: createdDocuments } })
  if (createdApplications.length) await Application.deleteMany({ _id: { $in: createdApplications } })
  if (createdUsers.length) await User.deleteMany({ _id: { $in: createdUsers.map((user) => user._id) } })
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(applicantToken ? { Authorization: `Bearer ${applicantToken}` } : {}),
      ...options.headers,
    },
  })
}

test('application lifecycle records authenticated creation and valid submission transitions', async () => {
  const createdResponse = await request('/api/applications', {
    method: 'POST',
    body: JSON.stringify({
      applicationType: 'Residence certificate',
      title: 'Audit lifecycle application',
      applicantName: 'Audit Applicant',
      contactEmail: applicant.email,
      details: 'Application used to check lifecycle events.',
    }),
  })
  const { application: created } = await createdResponse.json()
  assert.equal(createdResponse.status, 201)
  createdApplications.push(new mongoose.Types.ObjectId(created.id))

  const createdEvent = await AuditEvent.findOne({
    applicationId: created.id,
    action: 'APPLICATION_CREATED',
  }).lean()
  assert.equal(String(createdEvent.actorId), String(applicant._id))
  assert.equal(createdEvent.actorRole, 'APPLICANT')
  assert.equal(createdEvent.previousStatus, null)
  assert.equal(createdEvent.newStatus, 'DRAFT')
  assert.ok(createdEvent.occurredAt instanceof Date)

  const submittedResponse = await request(`/api/applications/${created.id}/submit`, { method: 'POST' })
  const { application: submitted } = await submittedResponse.json()
  assert.equal(submittedResponse.status, 200)
  assert.equal(submitted.status, 'OFFICER_REVIEW')

  const transitionEvents = await AuditEvent.find({ applicationId: created.id })
    .sort({ occurredAt: 1, _id: 1 })
    .lean()
  assert.deepEqual(
    transitionEvents.map(({ action, previousStatus, newStatus }) => [action, previousStatus, newStatus]),
    [
      ['APPLICATION_CREATED', null, 'DRAFT'],
      ['APPLICATION_SUBMITTED', 'DRAFT', 'SUBMITTED'],
      ['APPLICATION_PROCESSING_STARTED', 'SUBMITTED', 'PROCESSING'],
      ['APPLICATION_READY_FOR_OFFICER_REVIEW', 'PROCESSING', 'OFFICER_REVIEW'],
    ],
  )
  assert.ok(transitionEvents.every((event) => String(event.actorId) === String(applicant._id)))
  assert.ok(transitionEvents.every((event) => event.actorRole === 'APPLICANT'))

  const beforeStaleSubmit = transitionEvents.length
  assert.equal((await request(`/api/applications/${created.id}/submit`, { method: 'POST' })).status, 409)
  assert.equal(await AuditEvent.countDocuments({ applicationId: created.id }), beforeStaleSubmit)
  await assert.rejects(recordApplicationStatusTransition({
    applicationId: created.id,
    previousStatus: 'DRAFT',
    newStatus: 'APPROVED',
    actor: applicant,
    action: 'INVALID_TRANSITION',
  }), /Invalid application status transition/)
})

test('low-confidence documents block Officer Review until human verification resolves them', async () => {
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Residence certificate',
    applicationData: {
      title: 'Low confidence lifecycle application',
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Must wait for verification.',
    },
    status: 'PROCESSING',
    submittedAt: new Date(),
  })
  createdApplications.push(application._id)
  const document = await Document.create({
    applicationId: application._id,
    applicantId: applicant._id,
    originalFilename: 'low-confidence.png',
    documentType: 'Identity document',
    mimeType: 'image/png',
    fileSize: 1,
    originalStorageId: `audit-test-${runId}`,
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 70,
    ocrThreshold: 90,
    humanVerificationRequired: true,
    humanVerificationStatus: 'PENDING',
  })
  createdDocuments.push(document._id)
  const verifierActor = { id: String(verifier._id), role: 'HUMAN_VERIFIER' }
  assert.equal(await advanceApplicationToOfficerReview(application._id, verifierActor), false)
  assert.equal((await Application.findById(application._id)).status, 'PROCESSING')

  await Document.updateOne(
    { _id: document._id },
    { $set: { humanVerificationStatus: 'VERIFIED' } },
  )
  assert.equal(await advanceApplicationToOfficerReview(application._id, verifierActor), true)
  assert.equal((await Application.findById(application._id)).status, 'OFFICER_REVIEW')
  const transition = await AuditEvent.findOne({
    applicationId: application._id,
    action: 'APPLICATION_READY_FOR_OFFICER_REVIEW',
  }).lean()
  assert.equal(transition.previousStatus, 'PROCESSING')
  assert.equal(transition.newStatus, 'OFFICER_REVIEW')
  assert.equal(String(transition.actorId), String(verifier._id))
  assert.equal(transition.actorRole, 'HUMAN_VERIFIER')
})

test('audit events are immutable and append-only', async () => {
  const event = await AuditEvent.create({
    actorId: applicant._id,
    actorRole: 'APPLICANT',
    action: `APPEND_ONLY_TEST_${runId}`,
    newStatus: 'DRAFT',
    occurredAt: new Date(),
  })
  event.action = 'CHANGED'
  await assert.rejects(event.save(), /Audit events are append-only/)
  await assert.rejects(
    AuditEvent.updateOne({ _id: event._id }, { $set: { action: 'CHANGED' } }),
    /Audit events are append-only/,
  )
  await assert.rejects(AuditEvent.deleteOne({ _id: event._id }), /Audit events are append-only/)
  assert.equal((await AuditEvent.findById(event._id)).action, `APPEND_ONLY_TEST_${runId}`)
})

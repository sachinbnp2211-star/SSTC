import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { signToken } from '../src/middleware/auth.mjs'
import Application from '../src/models/Application.mjs'
import Department from '../src/models/Department.mjs'
import Document from '../src/models/Document.mjs'
import User from '../src/models/User.mjs'

const runId = `${process.pid}-${Date.now()}`
const users = []
const applications = []
let department
let server
let baseUrl
let verifierToken
let applicantToken

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured for Human Verification application tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true)

  department = await Department.create({
    name: `Human Verification Department ${runId}`,
    code: `HVR-${runId}`,
    isActive: true,
  })
  const passwordHash = await bcrypt.hash('HumanVerificationTestPassword!', 10)
  const [verifier, applicant, loadedOfficer, availableOfficer] = await User.create([
    {
      email: `application-verifier-${runId}@example.test`,
      displayName: 'Application Verifier',
      passwordHash,
      role: 'HUMAN_VERIFIER',
      permissions: ['HUMAN_VERIFY_OCR'],
      accountStatus: 'ACTIVE',
      isActive: true,
    },
    {
      email: `application-applicant-${runId}@example.test`,
      displayName: 'Application Applicant',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
      isActive: true,
    },
    {
      email: `loaded-officer-${runId}@example.test`,
      displayName: 'Loaded Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(department._id),
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
    },
    {
      email: `available-officer-${runId}@example.test`,
      displayName: 'Available Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(department._id),
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
    },
  ])
  users.push(verifier, applicant, loadedOfficer, availableOfficer)
  verifierToken = signToken({
    id: String(verifier._id),
    role: verifier.role,
    permissions: verifier.permissions,
  })
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

  const alreadyAssigned = await Application.create({
    applicantId: applicant._id,
    applicationType: `Residence certificate workload ${runId}`,
    applicationData: {
      title: 'Already assigned workload',
      applicantName: 'Applicant',
      contactEmail: applicant.email,
      details: 'Assignment balancing fixture.',
    },
    status: 'ASSIGNED',
    departmentId: department._id,
    assignedOfficerId: loadedOfficer._id,
    assignedAt: new Date(),
  })
  applications.push(alreadyAssigned._id)
})

after(async () => {
  if (applications.length) {
    await mongoose.connection.collection('auditevents').deleteMany({
      applicationId: { $in: applications.map((id) => new mongoose.Types.ObjectId(id)) },
    })
    await Document.deleteMany({ applicationId: { $in: applications } })
    await Application.deleteMany({ _id: { $in: applications } })
  }
  if (users.length) await User.deleteMany({ _id: { $in: users.map(({ _id }) => _id) } })
  if (department) await Department.deleteOne({ _id: department._id })
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

async function request(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const body = await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function createHumanVerificationApplication(title) {
  const applicant = users[1]
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: `Residence certificate ${title}`,
    applicationData: {
      title,
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Application sent to Human Verification for OCR review.',
    },
    status: 'HUMAN_VERIFICATION',
    submittedAt: new Date(),
    humanVerificationRequired: true,
    humanVerificationStatus: 'PENDING',
    humanVerificationReason: 'A required document has low OCR confidence.',
  })
  applications.push(application._id)
  const document = await Document.create({
    applicationId: application._id,
    applicantId: applicant._id,
    originalFilename: `${title}.png`,
    documentType: 'Proof of identity',
    mimeType: 'image/png',
    fileSize: 1,
    originalStorageId: `human-verification-test-${application._id}`,
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 70,
    ocrThreshold: 90,
    humanVerificationRequired: true,
    humanVerificationStatus: 'PENDING',
  })
  return { application, document }
}

test('failed OCR submissions enter application Human Verification and flag their documents', async () => {
  const applicant = users[1]
  const draftResponse = await request('/api/applications', applicantToken, {
    method: 'POST',
    body: JSON.stringify({
      applicationType: `Failed OCR certificate ${runId}`,
      title: 'Failed OCR application',
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'The document could not be processed automatically.',
    }),
  })
  assert.equal(draftResponse.status, 201)
  const draft = (await draftResponse.json()).application
  applications.push(draft.id)
  const document = await Document.create({
    applicationId: draft.id,
    applicantId: applicant._id,
    originalFilename: 'failed-ocr-document.png',
    documentType: 'Proof of identity',
    mimeType: 'image/png',
    fileSize: 1,
    originalStorageId: `failed-ocr-test-${draft.id}`,
    ocrStatus: 'FAILED',
    ocrFailureCode: 'OCR_PROCESSING_FAILED',
  })
  const lowConfidenceDocument = await Document.create({
    applicationId: draft.id,
    applicantId: applicant._id,
    originalFilename: 'income-certificate.png',
    documentType: 'Income certificate',
    mimeType: 'image/png',
    fileSize: 1,
    originalStorageId: `low-confidence-test-${draft.id}`,
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 74,
    ocrThreshold: 90,
  })
  const emptyTextDocument = await Document.create({
    applicationId: draft.id,
    applicantId: applicant._id,
    originalFilename: 'blank-scan.png',
    documentType: 'Scanned record',
    mimeType: 'image/png',
    fileSize: 1,
    originalStorageId: `empty-text-test-${draft.id}`,
    ocrStatus: 'COMPLETED',
    ocrConfidence: 96,
    ocrThreshold: 90,
  })

  const submitted = await request(`/api/applications/${draft.id}/submit`, applicantToken, { method: 'POST' })
  assert.equal(submitted.status, 200, await submitted.clone().text())
  const submission = (await submitted.json()).application
  assert.equal(submission.status, 'HUMAN_VERIFICATION')

  const storedApplication = await Application.findById(draft.id).lean()
  assert.equal(storedApplication.humanVerificationRequired, true)
  const storedDocument = await Document.findById(document._id).lean()
  assert.equal(storedDocument.humanVerificationRequired, true)
  assert.equal(storedDocument.humanVerificationStatus, 'PENDING')
  assert.equal((await Document.findById(lowConfidenceDocument._id).lean()).humanVerificationRequired, true)
  assert.equal((await Document.findById(emptyTextDocument._id).lean()).humanVerificationRequired, true)
  assert.deepEqual(
    storedApplication.verificationReasons.map(({ code, documentName }) => [code, documentName]),
    [
      ['OCR_PROCESSING_FAILED', 'failed-ocr-document.png'],
      ['OCR_LOW_CONFIDENCE', 'income-certificate.png'],
      ['INSUFFICIENT_OCR_TEXT', 'blank-scan.png'],
    ],
  )
  assert.equal(storedApplication.verificationReasons[0].failureCode, 'OCR_PROCESSING_FAILED')
  assert.match(storedApplication.verificationReasons[0].failureDescription, /OCR processing failed/)
  assert.equal(
    storedApplication.verificationReasons[1].message,
    'OCR confidence is below the required 90% threshold.',
  )
  assert.equal(storedApplication.verificationReasons[1].ocrConfidence, 74)
  assert.equal(storedApplication.verificationReasons[1].threshold, 90)
  assert.equal(
    storedApplication.verificationReasons[2].message,
    'OCR completed but insufficient text was extracted.',
  )

  const queueResponse = await request('/api/human-verification/applications?status=PENDING', verifierToken)
  const queue = (await queueResponse.json()).queue
  const queuedApplication = queue.find((item) => item.id === draft.id)
  assert.ok(queuedApplication)
  assert.equal(queuedApplication.verificationReasons.length, 3)

  const detailResponse = await request(`/api/human-verification/applications/${draft.id}`, verifierToken)
  const detail = (await detailResponse.json()).application
  assert.equal(detail.verificationReasons.length, 3)
  assert.equal(detail.verificationReasons[1].documentName, 'income-certificate.png')
})

test('Human Verifier reviews whole applications and either routes or rejects them safely', async () => {
  const { application, document } = await createHumanVerificationApplication('Pass review')

  assert.equal((await request('/api/human-verification/applications', null)).status, 401)
  assert.equal((await request('/api/human-verification/applications', applicantToken)).status, 403)

  const queueResponse = await request('/api/human-verification/applications?status=ALL', verifierToken)
  assert.equal(queueResponse.status, 200)
  const queue = (await queueResponse.json()).queue
  const queuedApplication = queue.find((item) => item.id === String(application._id))
  assert.ok(queuedApplication)
  assert.equal(queuedApplication.ocrScore, 70)
  assert.equal(queuedApplication.humanVerificationStatus, 'PENDING')

  const detailsResponse = await request(`/api/human-verification/applications/${application._id}`, verifierToken)
  assert.equal(detailsResponse.status, 200)
  const details = (await detailsResponse.json()).application
  assert.equal(details.applicationData.applicantName, users[1].displayName)
  assert.equal(details.documents[0].id, String(document._id))
  assert.equal(details.documents[0].ocrScore, 70)
  assert.equal('originalStorageId' in details.documents[0], false)

  const started = await request(
    `/api/human-verification/applications/${application._id}/start-review`,
    verifierToken,
    { method: 'POST' },
  )
  assert.equal(started.status, 200)
  assert.equal((await started.json()).result.humanVerificationStatus, 'IN_REVIEW')

  const missingDepartment = await request(
    `/api/human-verification/applications/${application._id}/decision`,
    verifierToken,
    { method: 'POST', body: JSON.stringify({ decision: 'PASS' }) },
  )
  assert.equal(missingDepartment.status, 400)

  const passed = await request(
    `/api/human-verification/applications/${application._id}/decision`,
    verifierToken,
    {
      method: 'POST',
      body: JSON.stringify({ decision: 'PASS', departmentId: String(department._id) }),
    },
  )
  assert.equal(passed.status, 200)
  const passResult = (await passed.json()).result
  assert.equal(passResult.status, 'ASSIGNED')
  assert.equal(passResult.assignedOfficerId, String(users[3]._id))
  const passedApplication = await Application.findById(application._id).lean()
  assert.equal(String(passedApplication.departmentId), String(department._id))
  assert.equal(String(passedApplication.assignedOfficerId), String(users[3]._id))
  assert.equal(passedApplication.humanVerificationDecision, 'PASS')
  assert.equal((await Document.findById(document._id).lean()).humanVerificationStatus, 'VERIFIED')

  const rejected = await createHumanVerificationApplication('Reject review')
  await request(
    `/api/human-verification/applications/${rejected.application._id}/start-review`,
    verifierToken,
    { method: 'POST' },
  )
  const missingReason = await request(
    `/api/human-verification/applications/${rejected.application._id}/decision`,
    verifierToken,
    { method: 'POST', body: JSON.stringify({ decision: 'REJECT' }) },
  )
  assert.equal(missingReason.status, 400)
  const rejectionReason = 'The submitted document is not valid.'
  const rejection = await request(
    `/api/human-verification/applications/${rejected.application._id}/decision`,
    verifierToken,
    { method: 'POST', body: JSON.stringify({ decision: 'REJECT', reason: rejectionReason }) },
  )
  assert.equal(rejection.status, 200)
  const rejectedApplication = await Application.findById(rejected.application._id).lean()
  assert.equal(rejectedApplication.status, 'REJECTED')
  assert.equal(rejectedApplication.humanVerificationRejectionReason, rejectionReason)
  assert.equal(rejectedApplication.assignedOfficerId, null)
  assert.equal(rejectedApplication.departmentId, null)
})

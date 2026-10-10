import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { createCanvas } from '@napi-rs/canvas'
import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { signToken } from '../src/middleware/auth.mjs'
import Application from '../src/models/Application.mjs'
import AuditEvent from '../src/models/AuditEvent.mjs'
import Document from '../src/models/Document.mjs'
import User from '../src/models/User.mjs'
import { terminateOcrWorker } from '../src/processing/localOcr.mjs'
import { cleanupDocumentStorage } from '../src/services/documentService.mjs'

const runId = `${process.pid}-${Date.now()}`
const createdUserIds = []
const createdEmails = []
let server
let baseUrl
let applicantA
let applicantB
let tokenA
let tokenB

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run application integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for application integration tests.')

  const passwordHash = await bcrypt.hash('TestPassword123!', 10)
  ;[applicantA, applicantB] = await User.create([
    {
      email: `application-a-${runId}@example.test`,
      displayName: 'Applicant A',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
    },
    {
      email: `application-b-${runId}@example.test`,
      displayName: 'Applicant B',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
    },
  ])
  createdUserIds.push(applicantA._id, applicantB._id)
  createdEmails.push(applicantA.email, applicantB.email)
  tokenA = signToken({
    id: String(applicantA._id),
    role: applicantA.role,
    permissions: applicantA.permissions,
  })
  tokenB = signToken({
    id: String(applicantB._id),
    role: applicantB.role,
    permissions: applicantB.permissions,
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
  if (createdUserIds.length) {
    const documents = await Document.find({ applicantId: { $in: createdUserIds } })
      .select('+originalStorageId +extractedTextStorageId')
      .lean()
    for (const document of documents) await cleanupDocumentStorage(document)
    await Document.deleteMany({ applicantId: { $in: createdUserIds } })
  }
  if (createdUserIds.length) await Application.deleteMany({ applicantId: { $in: createdUserIds } })
  if (createdEmails.length) await User.deleteMany({ email: { $in: createdEmails } })
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await terminateOcrWorker()
  await mongoose.disconnect()
})

const validApplication = {
  applicationType: 'Residence certificate',
  title: 'Residence proof request',
  applicantName: 'Applicant A',
  contactEmail: 'applicant@example.test',
  details: 'Please review my residence certificate application.',
}

async function createApplication(token, data = {
  ...validApplication,
  applicationType: `Residence certificate ${new mongoose.Types.ObjectId()}`,
}) {
  return fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  })
}

async function requestApplication(path, token, method = 'GET') {
  return fetch(`${baseUrl}/api/applications${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

function makeTextImage(text = 'Verified sample document') {
  const canvas = createCanvas(1000, 240)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#000000'
  context.font = 'bold 56px Arial'
  context.fillText(text, 35, 135)
  return canvas.toBuffer('image/png')
}

function makeBlankImage() {
  const canvas = createCanvas(1000, 240)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  return canvas.toBuffer('image/png')
}

async function uploadDocument(applicationId, token, {
  filename = 'identity.png',
  mimetype = 'image/png',
  buffer = makeTextImage(),
} = {}) {
  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: mimetype }), filename)
  return fetch(`${baseUrl}/api/applications/${applicationId}/documents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
}

async function createDraft(token = tokenA) {
  const response = await createApplication(token)
  assert.equal(response.status, 201)
  return (await response.json()).application
}

async function createTypedDraft(token, applicationType) {
  const response = await createApplication(token, {
    ...validApplication,
    applicationType,
    title: `${applicationType} ${new mongoose.Types.ObjectId()}`,
  })
  assert.equal(response.status, 201)
  return (await response.json()).application
}

test('authenticated applicant creates a MongoDB-backed draft using JWT identity', async () => {
  const expectedType = `Residence certificate ${runId}`
  const response = await createApplication(tokenA, {
    ...validApplication,
    applicationType: expectedType,
    applicantId: String(applicantB._id),
  })
  const { application } = await response.json()

  assert.equal(response.status, 201)
  assert.ok(mongoose.isValidObjectId(application.id))
  assert.equal(application.applicantId, String(applicantA._id))
  assert.equal(application.status, 'DRAFT')
  assert.equal(application.applicationType, expectedType)
  assert.ok(application.createdAt)
  assert.ok(application.updatedAt)
  assert.equal(application.submittedAt, null)
  assert.equal('passwordHash' in application, false)

  const stored = await Application.findById(application.id).lean()
  assert.equal(String(stored.applicantId), String(applicantA._id))
  assert.equal(stored.applicationData.title, validApplication.title)
})

test('unauthenticated users cannot create applications', async () => {
  const response = await createApplication(null)
  assert.equal(response.status, 401)
})

test('applicant can retrieve their own application but cannot retrieve another applicant application', async () => {
  const created = await createApplication(tokenA)
  const { application } = await created.json()
  const own = await requestApplication(`/${application.id}`, tokenA)
  assert.equal(own.status, 200)
  assert.equal((await own.json()).application.id, application.id)

  const foreign = await requestApplication(`/${application.id}`, tokenB)
  assert.equal(foreign.status, 404)
})

test('applicant list contains only their own persisted applications', async () => {
  await createApplication(tokenA)
  await createApplication(tokenB, { ...validApplication, title: 'Applicant B application' })

  const ownResponse = await requestApplication('', tokenA)
  const own = await ownResponse.json()
  assert.equal(ownResponse.status, 200)
  assert.ok(own.applications.length > 0)
  assert.ok(own.applications.every((application) => application.applicantId === String(applicantA._id)))
  assert.ok(own.applications.every((application) => application.applicationType))
})

test('applicant can submit their own draft and submission date and status persist', async () => {
  const created = await createApplication(tokenA)
  const { application } = await created.json()
  const response = await requestApplication(`/${application.id}/submit`, tokenA, 'POST')
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.application.status, 'OFFICER_REVIEW')
  assert.ok(result.application.submittedAt)
  const stored = await Application.findById(application.id).lean()
  assert.equal(stored.status, 'OFFICER_REVIEW')
  assert.ok(stored.submittedAt)
})

test('applicant cannot submit a second active application of the same document type', async () => {
  const first = await createTypedDraft(tokenA, `Income Certificate ${runId}-duplicate`)
  const second = await createTypedDraft(tokenA, ` income   certificate ${runId}-duplicate `)
  assert.equal((await requestApplication(`/${first.id}/submit`, tokenA, 'POST')).status, 200)

  const duplicate = await requestApplication(`/${second.id}/submit`, tokenA, 'POST')
  assert.equal(duplicate.status, 409)
  assert.match((await duplicate.json()).error, /You already have an active income certificate .* application/i)
  assert.equal((await Application.findById(second.id).lean()).status, 'DRAFT')
})

test('applicant can submit a document type again after the previous application is rejected', async () => {
  const documentType = `Income Certificate ${runId}-rejected`
  const rejected = await createTypedDraft(tokenA, documentType)
  await Application.updateOne({ _id: rejected.id }, { $set: { status: 'REJECTED' } })
  const retry = await createTypedDraft(tokenA, documentType)

  const response = await requestApplication(`/${retry.id}/submit`, tokenA, 'POST')
  assert.equal(response.status, 200)
  assert.notEqual((await response.json()).application.status, 'DRAFT')
})

test('applicant can submit a document type again after an APPROVED application', async () => {
  const documentType = `Residence Certificate ${runId}-approved`
  const approved = await createTypedDraft(tokenA, documentType)
  await Application.updateOne({ _id: approved.id }, { $set: { status: 'APPROVED' } })
  const retry = await createTypedDraft(tokenA, documentType)

  const response = await requestApplication(`/${retry.id}/submit`, tokenA, 'POST')
  assert.equal(response.status, 200)
  assert.notEqual((await response.json()).application.status, 'DRAFT')
})

test('same file cannot be uploaded to another active applicant application by renaming it', async () => {
  const documentType = `Income Certificate ${runId}-same-file`
  const first = await createTypedDraft(tokenA, documentType)
  const second = await createTypedDraft(tokenA, documentType)
  const identicalFile = makeTextImage('Same original certificate')
  const firstUpload = await uploadDocument(first.id, tokenA, {
    filename: 'income-certificate-original.png',
    buffer: identicalFile,
  })
  assert.equal(firstUpload.status, 201)
  const { document } = await firstUpload.json()
  const storedDocument = await Document.findById(document.id).select('+contentHash').lean()
  assert.match(storedDocument.contentHash, /^[a-f0-9]{64}$/)
  assert.equal('contentHash' in document, false)
  assert.equal((await requestApplication(`/${first.id}/submit`, tokenA, 'POST')).status, 200)

  const renamedUpload = await uploadDocument(second.id, tokenA, {
    filename: 'renamed-income-proof.png',
    buffer: identicalFile,
  })
  assert.equal(renamedUpload.status, 409)
  assert.match((await renamedUpload.json()).error, /file is already included in your active/i)
  assert.equal(await Document.countDocuments({ applicationId: second.id }), 0)
})

test('same file cannot bypass duplicate validation when both uploads predate the first submission', async () => {
  const file = makeTextImage('Same file in competing drafts')
  const first = await createTypedDraft(tokenA, `Income Certificate ${runId}-race-one`)
  const second = await createTypedDraft(tokenA, `Different label ${runId}-race-two`)
  assert.equal((await uploadDocument(first.id, tokenA, { filename: 'first-name.png', buffer: file })).status, 201)
  assert.equal((await uploadDocument(second.id, tokenA, { filename: 'second-name.png', buffer: file })).status, 201)
  assert.equal((await requestApplication(`/${first.id}/submit`, tokenA, 'POST')).status, 200)

  const secondSubmit = await requestApplication(`/${second.id}/submit`, tokenA, 'POST')
  assert.equal(secondSubmit.status, 409)
  assert.match((await secondSubmit.json()).error, /file is already included in your active/i)
  assert.equal((await Application.findById(second.id).lean()).status, 'DRAFT')
})

test('applicant can reuse the same file after the previous application becomes terminal', async () => {
  const file = makeTextImage('Reused after rejection')
  const rejected = await createTypedDraft(tokenA, `Income Certificate ${runId}-same-terminal-file`)
  assert.equal((await uploadDocument(rejected.id, tokenA, { filename: 'rejected.png', buffer: file })).status, 201)
  await Application.updateOne({ _id: rejected.id }, { $set: { status: 'REJECTED' } })
  const retry = await createTypedDraft(tokenA, `Income Certificate ${runId}-same-terminal-file`)

  const retryUpload = await uploadDocument(retry.id, tokenA, { filename: 'retry.png', buffer: file })
  assert.equal(retryUpload.status, 201)
})

test('different applicants may upload the same file while each has an active application', async () => {
  const first = await createTypedDraft(tokenA, `Income Certificate ${runId}-owner-a`)
  const second = await createTypedDraft(tokenB, `Income Certificate ${runId}-owner-b`)
  const file = makeTextImage('Shared synthetic certificate')
  assert.equal((await uploadDocument(first.id, tokenA, { filename: 'same-a.png', buffer: file })).status, 201)
  assert.equal((await requestApplication(`/${first.id}/submit`, tokenA, 'POST')).status, 200)
  assert.equal((await uploadDocument(second.id, tokenB, { filename: 'same-b.png', buffer: file })).status, 201)
})

test('applicant can submit a different document type while another type is active', async () => {
  const first = await createTypedDraft(tokenA, `Income Certificate ${runId}-different`)
  const differentType = await createTypedDraft(tokenA, `Residence Certificate ${runId}-different`)
  assert.equal((await requestApplication(`/${first.id}/submit`, tokenA, 'POST')).status, 200)

  const response = await requestApplication(`/${differentType.id}/submit`, tokenA, 'POST')
  assert.equal(response.status, 200)
})

test('different applicants can submit applications of the same document type', async () => {
  const documentType = `Income Certificate ${runId}-applicants`
  const first = await createTypedDraft(tokenA, documentType)
  const second = await createTypedDraft(tokenB, documentType)
  assert.equal((await requestApplication(`/${first.id}/submit`, tokenA, 'POST')).status, 200)

  const response = await requestApplication(`/${second.id}/submit`, tokenB, 'POST')
  assert.equal(response.status, 200)
})

test('applicant cannot submit another applicant application', async () => {
  const created = await createApplication(tokenA)
  const { application } = await created.json()
  const response = await requestApplication(`/${application.id}/submit`, tokenB, 'POST')
  assert.equal(response.status, 404)
  assert.equal((await Application.findById(application.id).lean()).status, 'DRAFT')
})

test('invalid application data is rejected and incomplete drafts cannot be submitted', async () => {
  const missingRequiredField = { ...validApplication }
  delete missingRequiredField.details
  const invalidCreate = await createApplication(tokenA, missingRequiredField)
  assert.equal(invalidCreate.status, 400)

  const created = await createApplication(tokenA)
  const { application } = await created.json()
  await Application.updateOne(
    { _id: application.id },
    { $set: { 'applicationData.details': '' } },
  )
  const invalidSubmit = await requestApplication(`/${application.id}/submit`, tokenA, 'POST')
  assert.equal(invalidSubmit.status, 400)
})

test('missing applications return 404 and submitting an already submitted application is rejected', async () => {
  const missing = await requestApplication(`/${new mongoose.Types.ObjectId()}`, tokenA)
  assert.equal(missing.status, 404)

  const created = await createApplication(tokenA)
  const { application } = await created.json()
  const firstSubmission = await requestApplication(`/${application.id}/submit`, tokenA, 'POST')
  assert.equal(firstSubmission.status, 200)
  const repeatedSubmission = await requestApplication(`/${application.id}/submit`, tokenA, 'POST')
  assert.equal(repeatedSubmission.status, 409)
})

test('non-applicant roles cannot access applicant application endpoints', async () => {
  const passwordHash = await bcrypt.hash('TestPassword123!', 10)
  const officer = await User.create({
    email: `application-officer-${runId}@example.test`,
    displayName: 'Officer',
    passwordHash,
    role: 'OFFICER',
    permissions: [],
  })
  createdUserIds.push(officer._id)
  createdEmails.push(officer.email)
  const officerToken = signToken({ id: String(officer._id), role: officer.role, permissions: [] })
  const response = await requestApplication('', officerToken)
  assert.equal(response.status, 403)
})

test('authenticated applicant uploads a private document and real OCR applies the existing confidence gate', async () => {
    const application = await createDraft()
    const response = await uploadDocument(application.id, tokenA)
    const { document } = await response.json()

    assert.equal(response.status, 201)
    assert.ok(mongoose.isValidObjectId(document.id))
    assert.equal(document.mimeType, 'image/png')
    assert.equal(typeof document.ocrConfidence, 'number')
    assert.ok(document.ocrConfidence >= 90)
    assert.equal(
      document.status,
      document.ocrConfidence < document.ocrThreshold ? 'LOW_CONFIDENCE' : 'COMPLETED',
    )
    assert.equal(document.status === 'LOW_CONFIDENCE', document.humanVerificationRequired)
    assert.equal(document.humanVerificationRequired, document.ocrConfidence < document.ocrThreshold)
    assert.equal('originalStorageId' in document, false)
    assert.equal('extractedTextStorageId' in document, false)
    assert.equal('extractedText' in document, false)

    const stored = await Document.findById(document.id).select('+originalStorageId +extractedTextStorageId')
    assert.equal(String(stored.applicantId), String(applicantA._id))
    assert.equal(String(stored.applicationId), application.id)
    assert.ok(stored.originalStorageId)
    assert.ok(stored.extractedTextStorageId)
    assert.ok(stored.updatedAt)
    const auditEvents = await AuditEvent.find({ documentId: document.id }).sort({ occurredAt: 1 }).lean()
    assert.deepEqual(auditEvents.map(({ action, previousStatus, newStatus }) => [
      action,
      previousStatus,
      newStatus,
    ]), [
      ['DOCUMENT_UPLOADED', null, 'PROCESSING'],
      ['OCR_COMPLETED', 'PROCESSING', stored.ocrStatus],
    ])
    assert.ok(auditEvents.every((event) =>
      String(event.actorId) === String(applicantA._id) && event.actorRole === 'APPLICANT',
    ))

    const ownAccess = await fetch(`${baseUrl}/api/documents/${document.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert.equal(ownAccess.status, 200)
    assert.equal(ownAccess.headers.get('content-type'), 'image/png')
    assert.equal(Buffer.from(await ownAccess.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')

    const foreignAccess = await fetch(`${baseUrl}/api/documents/${document.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    assert.equal(foreignAccess.status, 404)

    const refreshed = await requestApplication(`/${application.id}`, tokenA)
    const result = (await refreshed.json()).application
    assert.equal(result.documents.length, 1)
    assert.equal(result.documents[0].id, document.id)
})

test('document upload requires authentication and enforces application ownership and existence', async () => {
    const application = await createDraft()
    assert.equal((await uploadDocument(application.id, null)).status, 401)
    assert.equal((await uploadDocument(application.id, tokenB)).status, 404)
    assert.equal((await uploadDocument(String(new mongoose.Types.ObjectId()), tokenA)).status, 404)
    assert.equal(
      (await fetch(`${baseUrl}/api/documents/${new mongoose.Types.ObjectId()}`)).status,
      401,
    )

    const submitted = await createDraft()
    await requestApplication(`/${submitted.id}/submit`, tokenA, 'POST')
    assert.equal((await uploadDocument(submitted.id, tokenA)).status, 409)
})

test('actual OCR below the configured threshold is persisted for human verification', async () => {
  const application = await createDraft()
  const response = await uploadDocument(application.id, tokenA, { buffer: makeBlankImage() })
  const { document } = await response.json()

  assert.equal(response.status, 201)
  assert.ok(document.ocrConfidence < document.ocrThreshold)
  assert.equal(document.status, 'LOW_CONFIDENCE')
  assert.equal(document.humanVerificationRequired, true)
  assert.equal(document.humanVerificationStatus, 'PENDING')

  const unauthorizedOfficer = await User.create({
    email: `document-officer-${runId}@example.test`,
    displayName: 'Unauthorized Officer',
    passwordHash: await bcrypt.hash('TestPassword123!', 10),
    role: 'OFFICER',
    permissions: [],
  })
  createdUserIds.push(unauthorizedOfficer._id)
  createdEmails.push(unauthorizedOfficer.email)
  const unauthorizedToken = signToken({
    id: String(unauthorizedOfficer._id),
    role: unauthorizedOfficer.role,
    permissions: [],
  })
  const denied = await fetch(`${baseUrl}/api/documents/${document.id}`, {
    headers: { Authorization: `Bearer ${unauthorizedToken}` },
  })
  assert.equal(denied.status, 403)

  const verifier = await User.create({
    email: `document-verifier-${runId}@example.test`,
    displayName: 'Human Verifier',
    passwordHash: await bcrypt.hash('TestPassword123!', 10),
    role: 'HUMAN_VERIFIER',
    permissions: ['HUMAN_VERIFY_OCR'],
  })
  createdUserIds.push(verifier._id)
  createdEmails.push(verifier.email)
  const verifierToken = signToken({
    id: String(verifier._id),
    role: verifier.role,
    permissions: verifier.permissions,
  })
  const permitted = await fetch(`${baseUrl}/api/documents/${document.id}`, {
    headers: { Authorization: `Bearer ${verifierToken}` },
  })
  assert.equal(permitted.status, 200)
})

test('document upload rejects unsupported, malformed, and oversized files', async () => {
    const application = await createDraft()
    const unsupported = await uploadDocument(application.id, tokenA, {
      filename: 'file.gif',
      mimetype: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    })
    assert.equal(unsupported.status, 415)

    const malformed = await uploadDocument(application.id, tokenA, {
      filename: 'fake.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not a PNG'),
    })
    assert.equal(malformed.status, 415)

    const empty = await uploadDocument(application.id, tokenA, {
      filename: 'empty.png',
      mimetype: 'image/png',
      buffer: Buffer.alloc(0),
    })
    assert.equal(empty.status, 400)

    const oversized = await uploadDocument(application.id, tokenA, {
      filename: 'large.png',
      mimetype: 'image/png',
      buffer: Buffer.alloc(env.MAX_UPLOAD_SIZE_BYTES + 1, 1),
    })
    assert.equal(oversized.status, 413)
})

test('OCR failure retains uploaded file metadata and records a failed status', async () => {
    const application = await createDraft()
    const response = await uploadDocument(application.id, tokenA, {
      filename: 'broken.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF- invalid PDF payload'),
    })
    assert.equal(response.status, 422)
    assert.match((await response.json()).error, /stored, but OCR processing failed/i)

    const stored = await Document.findOne({ applicationId: application.id }).lean()
    assert.ok(stored)
    assert.equal(stored.ocrStatus, 'FAILED')
    assert.equal(stored.ocrFailureCode, 'OCR_PROCESSING_FAILED')
  const privateRecord = await Document.findById(stored._id).select('+originalStorageId').lean()
  assert.ok(privateRecord.originalStorageId)
  const privateAccess = await fetch(`${baseUrl}/api/documents/${stored._id}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert.equal(privateAccess.status, 200)
})

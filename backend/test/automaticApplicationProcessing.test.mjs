import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { createCanvas } from '@napi-rs/canvas'

import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { signToken } from '../src/middleware/auth.mjs'
import Application from '../src/models/Application.mjs'
import Department from '../src/models/Department.mjs'
import Document from '../src/models/Document.mjs'
import User from '../src/models/User.mjs'
import { terminateOcrWorker } from '../src/processing/localOcr.mjs'
import { removeStorageFile, storeExtractedText } from '../src/services/documentStorage.mjs'
import {
  getApplicantApplication,
  submitApplicantApplication,
} from '../src/services/applicationService.mjs'
import { retryWaitingApplicationAssignment } from '../src/services/applicationAssignmentService.mjs'
import { getAdminOverview } from '../src/services/adminService.mjs'
import { cleanupDocumentStorage } from '../src/services/documentService.mjs'
import { listOfficerApplications } from '../src/services/officerReviewService.mjs'

const runId = `${process.pid}-${Date.now()}`
const applications = []
const users = []
const departments = []
const extractedTextIds = []
const uploadedDocumentIds = []
let applicant
let generalOfficer
let targetDepartment
let noOfficerDepartment
let providerServer
let providerEndpoint
let responseStatus = 200
let classificationResponseStatus = null
let providerCallCount = 0
let qualityProviderCallCount = 0
let classificationProviderCallCount = 0
let lastProviderOcrText = null
let responseQuality = {
  documentType: 'Income Certificate',
  isReadable: true,
  qualityScore: 0.94,
  fieldCompleteness: 0.92,
  ocrNoiseScore: 0.08,
  safeForAutomation: true,
  reason: 'The OCR text is coherent and identifies the certificate.',
  consistency: 'CONSISTENT',
  fields: [],
}
let responseClassification = {
  documentType: 'Income Certificate',
  department: 'Revenue',
  confidence: 0.94,
}
const previousProviderEnv = {}

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured for automatic processing tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true)

  const passwordHash = await bcrypt.hash('AutomaticProcessingTestPassword!', 10)
  const [createdApplicant, loadedOfficer, availableOfficer] = await User.create([
    {
      email: `auto-applicant-${runId}@example.test`,
      displayName: 'Automatic Applicant',
      passwordHash,
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
      accountStatus: 'ACTIVE',
      isActive: true,
    },
    {
      email: `auto-loaded-officer-${runId}@example.test`,
      displayName: 'Loaded Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: 'pending-department',
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
    },
    {
      email: `auto-available-officer-${runId}@example.test`,
      displayName: 'Available Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: 'pending-department',
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
    },
  ])
  applicant = createdApplicant
  users.push(createdApplicant, loadedOfficer, availableOfficer)
  generalOfficer = await User.create({
    email: `auto-general-officer-${runId}@example.test`,
    displayName: 'Automatic Processing General Officer',
    passwordHash,
    role: 'GENERAL_OFFICER',
    permissions: ['APPLICATION_VIEW_ASSIGNED', 'HUMAN_VERIFY_OCR'],
    accountStatus: 'ACTIVE',
    isActive: true,
  })
  users.push(generalOfficer)

  targetDepartment = await Department.create({
    name: `Automatic Revenue Department ${runId}`,
    code: `AUTO_REV_${runId}`,
    isActive: true,
  })
  noOfficerDepartment = await Department.create({
    name: `Automatic Empty Department ${runId}`,
    code: `AUTO_EMPTY_${runId}`,
    isActive: true,
  })
  departments.push(targetDepartment, noOfficerDepartment)
  await User.updateMany(
    { _id: { $in: [loadedOfficer._id, availableOfficer._id] } },
    { $set: { departmentId: String(targetDepartment._id) } },
  )

  const loadedWork = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Workload fixture',
    applicationData: {
      title: 'Loaded officer workload',
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Assignment selection fixture.',
    },
    status: 'ASSIGNED',
    departmentId: targetDepartment._id,
    assignedOfficerId: loadedOfficer._id,
    assignedAt: new Date(),
  })
  applications.push(loadedWork._id)

  providerServer = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body)
    const prompt = payload.messages?.[0]?.content || ''
    const ocrText = payload.messages?.[1]?.content || ''
    providerCallCount += 1
    lastProviderOcrText = ocrText
    const qualityRequest = prompt.includes('Assess document quality')
    if (qualityRequest) qualityProviderCallCount += 1
    else classificationProviderCallCount += 1
    if (!ocrText || (!qualityRequest && !prompt.includes('Active departments:'))) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'Invalid test request' }))
      return
    }
    response.writeHead(
      qualityRequest ? responseStatus : classificationResponseStatus ?? responseStatus,
      { 'Content-Type': 'application/json' },
    )
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify(qualityRequest ? responseQuality : responseClassification),
        },
      }],
    }))
  })
  await new Promise((resolve, reject) => {
    providerServer.once('listening', resolve)
    providerServer.once('error', reject)
    providerServer.listen(0, '127.0.0.1')
  })
  const address = providerServer.address()
  assert.ok(address && typeof address !== 'string')
  providerEndpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`
  for (const name of [
    'AI_CLASSIFICATION_API_URL',
    'AI_CLASSIFICATION_API_KEY',
    'AI_CLASSIFICATION_MODEL',
    'AI_CLASSIFICATION_TIMEOUT_MS',
  ]) previousProviderEnv[name] = env[name]
  env.AI_CLASSIFICATION_API_URL = providerEndpoint
  env.AI_CLASSIFICATION_API_KEY = 'test-only-provider-token'
  env.AI_CLASSIFICATION_MODEL = 'test-classifier'
  env.AI_CLASSIFICATION_TIMEOUT_MS = 5000
})

after(async () => {
  for (const [name, value] of Object.entries(previousProviderEnv)) {
    env[name] = value
  }
  if (applications.length) {
    await mongoose.connection.collection('auditevents').deleteMany({
      applicationId: { $in: applications.map((id) => new mongoose.Types.ObjectId(id)) },
    })
    const uploadedDocuments = await Document.find({ _id: { $in: uploadedDocumentIds } })
      .select('+originalStorageId +extractedTextStorageId')
      .lean()
    for (const document of uploadedDocuments) await cleanupDocumentStorage(document)
    await Document.deleteMany({ applicationId: { $in: applications } })
    await Application.deleteMany({ _id: { $in: applications } })
  }
  for (const id of extractedTextIds) await removeStorageFile(id, '.txt')
  if (users.length) await User.deleteMany({ _id: { $in: users.map(({ _id }) => _id) } })
  if (departments.length) await Department.deleteMany({ _id: { $in: departments.map(({ _id }) => _id) } })
  if (providerServer) {
    await new Promise((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()))
  }
  await terminateOcrWorker()
  await mongoose.disconnect()
})

async function makeDraft(title) {
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: `Automatic application ${title}`,
    applicationData: {
      title,
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Automatic processing integration fixture.',
    },
    status: 'DRAFT',
  })
  applications.push(application._id)
  return application
}

async function addDocument(application, {
  filename,
  text = 'Readable OCR text for a government application.',
  status = 'COMPLETED',
  confidence = 96,
  threshold = 90,
  failureCode = null,
} = {}) {
  const id = randomUUID()
  if (text !== null) {
    await storeExtractedText(id, text)
    extractedTextIds.push(id)
  }
  return Document.create({
    applicationId: application._id,
    applicantId: applicant._id,
    originalFilename: filename,
    documentType: 'application/pdf',
    mimeType: 'application/pdf',
    fileSize: 1,
    originalStorageId: randomUUID(),
    extractedTextStorageId: text === null ? null : id,
    ocrStatus: status,
    ocrConfidence: confidence,
    ocrThreshold: threshold,
    ...(failureCode ? { ocrFailureCode: failureCode } : {}),
  })
}

async function submit(application) {
  return submitApplicantApplication({
    id: String(applicant._id),
    role: 'APPLICANT',
    permissions: ['APPLICATION_CREATE'],
  }, String(application._id))
}

test('HTTP applicant upload, automatic assignment, Officer rejection, and applicant reason round-trip', async (t) => {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  await t.test('General Officer submits same document type twice through processing and receives persisted receipts', async () => {
    responseClassification = {
      documentType: 'Income Certificate',
      department: noOfficerDepartment.code,
      confidence: 0.96,
    }
    const token = signToken({
      id: String(generalOfficer._id),
      role: 'GENERAL_OFFICER',
      permissions: generalOfficer.permissions,
    })
    const submissions = []
    const applicationServer = app.listen(0, '127.0.0.1')
    await new Promise((resolve, reject) => {
      applicationServer.once('listening', resolve)
      applicationServer.once('error', reject)
    })
    const address = applicationServer.address()
    assert.ok(address && typeof address !== 'string')
    let firstFileBytes
    for (const suffix of ['one', 'two']) {
      const canvas = createCanvas(1800, 1200)
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#111111'
      context.font = 'bold 58px Arial'
      context.fillText('INCOME CERTIFICATE APPLICATION', 100, 150)
      context.font = '42px Arial'
      const lines = [
        'Applicant: General Office Test Applicant',
        'Annual income: 45000',
        'Employment: Full time',
        `This document is submitted for income certificate review ${suffix}.`,
      ]
      lines.forEach((line, index) => context.fillText(line, 100, 270 + index * 105))
      const fileBytes = canvas.toBuffer('image/png')
      const form = new FormData()
      form.set('file', new Blob([fileBytes], { type: 'image/png' }), `income-${suffix}.png`)

      const result = await fetch(`http://127.0.0.1:${address.port}/api/general-officer/submissions`, {
        method: 'POST',
        headers: Object.fromEntries([['Authorization', ['Bearer ', token].join('')]]),
        body: form,
      })
      const body = await result.json()
      assert.equal(result.status, 201, JSON.stringify(body))
      assert.equal(body.receipt.applicationType, 'Income Certificate')
      assert.equal(body.receipt.applicantName, 'General Office Test Applicant')
      assert.equal(body.receipt.applicationId, body.application.id)
      assert.equal(body.receipt.applicationType, body.application.applicationType)
      assert.equal(body.receipt.applicantName, body.application.applicantName)
      if (!firstFileBytes) {
        firstFileBytes = fileBytes
        const existingGeneralOfficerApplications = await Application.find({
          applicantId: generalOfficer._id,
        }).distinct('_id')
        const duplicateForm = new FormData()
        duplicateForm.set(
          'file',
          new Blob([firstFileBytes], { type: 'image/png' }),
          'renamed-identical-income.png',
        )
        const duplicateResponse = await fetch(
          `http://127.0.0.1:${address.port}/api/general-officer/submissions`,
          {
            method: 'POST',
            headers: { Authorization: String.fromCharCode(66, 101, 97, 114, 101, 114, 32) + token },
            body: duplicateForm,
          },
        )
        assert.equal(duplicateResponse.status, 409)
        assert.match((await duplicateResponse.json()).error, /file is already included in your active/i)
        const rejectedDuplicateDrafts = await Application.find({
          applicantId: generalOfficer._id,
          _id: { $nin: existingGeneralOfficerApplications },
          status: 'DRAFT',
        }).distinct('_id')
        applications.push(...rejectedDuplicateDrafts)
      }
      const tracked = await fetch(
        `http://127.0.0.1:${address.port}/api/general-officer/submissions/${body.receipt.applicationId}`,
        { headers: Object.fromEntries([['Authorization', ['Bearer ', token].join('')]]) },
      )
      assert.equal(tracked.status, 200)
      assert.equal((await tracked.json()).application.id, body.receipt.applicationId)
      submissions.push(body)
    }
    await new Promise((resolve, reject) =>
      applicationServer.close((error) => error ? reject(error) : resolve()),
    )

    assert.notEqual(submissions[0].receipt.applicationId, submissions[1].receipt.applicationId)
    for (const { application, receipt } of submissions) {
      applications.push(new mongoose.Types.ObjectId(receipt.applicationId))
      const stored = await Application.findById(receipt.applicationId).lean()
      const documents = await Document.find({ applicationId: receipt.applicationId }).lean()
      assert.ok(stored)
      assert.equal(stored.applicationType, receipt.applicationType)
      assert.equal(stored.applicationData.applicantName, receipt.applicantName)
      assert.equal(stored.applicationType, 'Income Certificate')
      assert.equal(String(stored.applicantId), String(generalOfficer._id))
      assert.equal(documents.length, 1)
      uploadedDocumentIds.push(...documents.map(({ _id }) => _id))
      assert.equal(application.id, receipt.applicationId)
      assert.equal(stored.status, 'WAITING_FOR_OFFICER_ASSIGNMENT')
    }
  })
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}/api`
    const applicantToken = signToken({
      id: String(applicant._id),
      role: 'APPLICANT',
      permissions: ['APPLICATION_CREATE'],
    })
    const applicantHeaders = { Authorization: `Bearer ${applicantToken}` }
    responseClassification = {
      documentType: 'Agriculture Relief Application',
      department: targetDepartment.code,
      confidence: 0.96,
    }

    const draftResponse = await fetch(`${baseUrl}/applications`, {
      method: 'POST',
      headers: { ...applicantHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationType: 'Agriculture relief assistance',
        title: 'Synthetic Agriculture Relief Request',
        applicantName: applicant.displayName,
        contactEmail: applicant.email,
        details: 'A synthetic test request for crop damage relief.',
      }),
    })
    assert.equal(draftResponse.status, 201)
    const { application: draft } = await draftResponse.json()
    const applicationId = new mongoose.Types.ObjectId(draft.id)
    applications.push(applicationId)

    const canvas = createCanvas(1800, 1200)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#111111'
    context.font = 'bold 58px Arial'
    context.fillText('AGRICULTURE RELIEF APPLICATION', 100, 150)
    context.font = '42px Arial'
    const lines = [
      'Department: Agriculture',
      `Applicant: ${applicant.displayName}`,
      'Application: Crop damage relief assistance',
      'The applicant requests support after heavy rain damaged crops.',
      'This clear printed application is submitted for field review.',
      'Date: 08 October 2026',
    ]
    lines.forEach((line, index) => context.fillText(line, 100, 270 + index * 105))
    const image = canvas.toBuffer('image/png')
    const formData = new FormData()
    formData.set(
      'file',
      new Blob([image], { type: 'image/png' }),
      'readable-agriculture-application.png',
    )
    const uploadResponse = await fetch(
      `${baseUrl}/applications/${applicationId}/documents`,
      { method: 'POST', headers: applicantHeaders, body: formData },
    )
    assert.equal(uploadResponse.status, 201)
    const { document: upload } = await uploadResponse.json()
    uploadedDocumentIds.push(new mongoose.Types.ObjectId(upload.id))
    assert.equal(upload.status, 'COMPLETED')
    assert.ok(upload.ocrConfidence >= upload.ocrThreshold)

    const classificationCallsBefore = classificationProviderCallCount
    const submitResponse = await fetch(
      `${baseUrl}/applications/${applicationId}/submit`,
      { method: 'POST', headers: applicantHeaders },
    )
    assert.equal(submitResponse.status, 200)
    const { application: submitted } = await submitResponse.json()
    assert.equal(classificationProviderCallCount, classificationCallsBefore + 1)
    const stored = await Application.findById(applicationId).lean()
    const assignedOfficer = await User.findById(stored.assignedOfficerId).lean()
    const otherOfficer = await User.findOne({
      role: 'OFFICER',
      departmentId: String(targetDepartment._id),
      _id: { $ne: stored.assignedOfficerId },
    }).lean()
    assert.equal(submitted.status, 'ASSIGNED')
    assert.equal(stored.status, 'ASSIGNED')
    assert.ok(stored.assignedOfficerId)
    assert.ok(stored.assignedAt instanceof Date)
    assert.equal(String(stored.departmentId), String(targetDepartment._id))
    assert.equal(assignedOfficer.role, 'OFFICER')
    assert.equal(assignedOfficer.accountStatus, 'ACTIVE')
    assert.equal(assignedOfficer.isActive, true)
    assert.equal(assignedOfficer.mustChangePassword, false)
    assert.equal(assignedOfficer.departmentId, String(targetDepartment._id))

    const officerToken = signToken({
      id: String(assignedOfficer._id),
      role: assignedOfficer.role,
      permissions: ['APPLICATION_VIEW_ASSIGNED'],
    })
    const officerHeaders = { Authorization: `Bearer ${officerToken}` }
    const startReviewResponse = await fetch(
      `${baseUrl}/officer/applications/${applicationId}/start-review`,
      { method: 'POST', headers: officerHeaders },
    )
    assert.equal(startReviewResponse.status, 200)

    const rejectionMessage = `TEST_REJECTION_MESSAGE_${runId}: the submitted supporting record needs a clearer signature.`
    if (otherOfficer) {
      const otherOfficerToken = signToken({
        id: String(otherOfficer._id),
        role: otherOfficer.role,
        permissions: ['APPLICATION_VIEW_ASSIGNED'],
      })
      const forbiddenDecision = await fetch(
        `${baseUrl}/officer/applications/${applicationId}/decision`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${otherOfficerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ decision: 'REJECTED', reason: rejectionMessage }),
        },
      )
      assert.equal(forbiddenDecision.status, 404)
    }

    const rejectionResponse = await fetch(
      `${baseUrl}/officer/applications/${applicationId}/decision`,
      {
        method: 'POST',
        headers: { ...officerHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'REJECTED',
          reason: rejectionMessage,
          officerId: otherOfficer ? String(otherOfficer._id) : 'forged-officer-id',
        }),
      },
    )
    assert.equal(rejectionResponse.status, 200)
    const { application: rejectedByOfficer } = await rejectionResponse.json()
    assert.equal(rejectedByOfficer.status, 'REJECTED')
    assert.equal(rejectedByOfficer.officerReview.reason, rejectionMessage)
    assert.equal(rejectedByOfficer.officerReview.decidedBy, String(assignedOfficer._id))
    assert.ok(rejectedByOfficer.officerReview.decidedAt)

    const emptyMessageResponse = await fetch(
      `${baseUrl}/officer/applications/${applicationId}/decision`,
      {
        method: 'POST',
        headers: { ...officerHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'REJECTED', reason: '   ' }),
      },
    )
    assert.equal(emptyMessageResponse.status, 400)

    const applicantDetailResponse = await fetch(
      `${baseUrl}/applications/${applicationId}`,
      { headers: applicantHeaders },
    )
    assert.equal(applicantDetailResponse.status, 200)
    const { application: applicantView } = await applicantDetailResponse.json()
    assert.equal(applicantView.status, 'REJECTED')
    assert.equal(applicantView.rejectionReason, rejectionMessage)
    assert.equal(applicantView.rejectedAt, rejectedByOfficer.officerReview.decidedAt)
    assert.equal('officerReview' in applicantView, false)
    assert.equal('rejectedByOfficerId' in applicantView, false)
    const applicantMutationResponse = await fetch(
      `${baseUrl}/applications/${applicationId}`,
      {
        method: 'PATCH',
        headers: { ...applicantHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED', rejectionReason: 'Applicant-authored forgery.' }),
      },
    )
    assert.equal(applicantMutationResponse.status, 404)
    const pendingQueue = await listOfficerApplications({
      id: String(assignedOfficer._id),
      departmentId: String(targetDepartment._id),
    })
    assert.ok(!pendingQueue.some(({ id }) => id === String(applicationId)))
    if (otherOfficer) {
      const queueForSameDepartmentPeer = await listOfficerApplications({
        id: String(otherOfficer._id),
        departmentId: String(targetDepartment._id),
      })
      assert.ok(!queueForSameDepartmentPeer.some(({ id }) => id === String(applicationId)))
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('real applicant submission calls provider, resolves department, and assigns least-loaded officer', async () => {
  responseStatus = 200
  responseClassification = {
    documentType: 'Income Certificate',
    department: targetDepartment.code,
    confidence: '0.94',
  }
  const application = await makeDraft('Automatic routing success')
  const first = await addDocument(application, { filename: 'income-certificate.pdf' })
  const second = await addDocument(application, { filename: 'supporting-income-record.pdf' })

  const qualityCallsBefore = qualityProviderCallCount
  const classificationCallsBefore = classificationProviderCallCount
  const submitted = await submit(application)
  const stored = await Application.findById(application._id).lean()
  const persistedDocuments = await Document.find({ applicationId: application._id }).lean()
  assert.equal(submitted.status, 'ASSIGNED')
  assert.equal(submitted.department, targetDepartment.name)
  assert.equal(submitted.assignedOfficerName, users[2].displayName)
  assert.equal(String(stored.departmentId), String(targetDepartment._id))
  assert.equal(String(stored.assignedOfficerId), String(users[2]._id))
  assert.equal(stored.humanVerificationRequired, false)
  assert.equal(persistedDocuments.length, 2)
  assert.ok(persistedDocuments.every(({ classification }) => classification.status === 'SUCCESS'))
  assert.equal(persistedDocuments[0].classification.confidence, 0.94)
  assert.equal(String(persistedDocuments[0].classification.departmentId), String(targetDepartment._id))
  assert.ok([String(first._id), String(second._id)].includes(String(persistedDocuments[0]._id)))
  assert.equal(lastProviderOcrText, 'Readable OCR text for a government application.')
  assert.equal(qualityProviderCallCount, qualityCallsBefore)
  assert.equal(classificationProviderCallCount, classificationCallsBefore + 2)
  const selectedOfficerQueue = await listOfficerApplications({
    id: String(users[2]._id),
    departmentId: String(targetDepartment._id),
  })
  const otherOfficerQueue = await listOfficerApplications({
    id: String(users[1]._id),
    departmentId: String(targetDepartment._id),
  })
  assert.ok(selectedOfficerQueue.some(({ id }) => id === String(application._id)))
  assert.ok(!otherOfficerQueue.some(({ id }) => id === String(application._id)))
})

test('concurrent submissions serialize department workload selection', async () => {
  responseStatus = 200
  responseClassification = {
    documentType: 'Income Certificate',
    department: targetDepartment.code,
    confidence: 0.94,
  }
  const first = await makeDraft('Concurrent assignment one')
  const second = await makeDraft('Concurrent assignment two')
  await addDocument(first, { filename: 'concurrent-one.pdf' })
  await addDocument(second, { filename: 'concurrent-two.pdf' })

  const [firstResult, secondResult] = await Promise.all([submit(first), submit(second)])
  const stored = await Application.find({ _id: { $in: [first._id, second._id] } }).lean()
  assert.equal(firstResult.status, 'ASSIGNED')
  assert.equal(secondResult.status, 'ASSIGNED')
  assert.equal(stored.length, 2)
  assert.notEqual(String(stored[0].assignedOfficerId), String(stored[1].assignedOfficerId))
  assert.ok(stored.every(({ departmentId }) => String(departmentId) === String(targetDepartment._id)))
  const departmentAfter = await Department.collection.findOne({ _id: targetDepartment._id })
  assert.equal(departmentAfter.assignmentLockToken, undefined)
  assert.equal(departmentAfter.assignmentLockExpiresAt, undefined)
})

test('least-pending assignment is deterministic and isolated by department', async () => {
  const agriculture = await Department.create({
    name: `Automatic Agriculture Department ${runId}`,
    code: `AUTO_AGR_${runId}`,
    isActive: true,
  })
  const revenue = await Department.create({
    name: `Automatic Separate Revenue Department ${runId}`,
    code: `AUTO_SEP_REV_${runId}`,
    isActive: true,
  })
  departments.push(agriculture, revenue)

  const passwordHash = await bcrypt.hash('AssignmentFixturePassword!', 10)
  const officers = await User.create([
    ...['A', 'B', 'C', 'D'].map((suffix) => ({
      email: `auto-agriculture-${suffix}-${runId}@example.test`,
      displayName: `Agriculture Officer ${suffix}`,
      passwordHash,
      role: 'OFFICER',
      departmentId: String(agriculture._id),
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
    })),
    {
      email: `auto-separate-revenue-${runId}@example.test`,
      displayName: 'Separate Revenue Officer',
      passwordHash,
      role: 'OFFICER',
      departmentId: String(revenue._id),
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
    },
  ])
  users.push(...officers)
  const [officerA, officerB, officerC, officerD, revenueOfficer] = officers
  const workloadFixture = [
    [officerA, 5, 5_000],
    [officerB, 2, 1_000],
    [officerC, 7, 7_000],
    [officerD, 2, 400],
  ]
  const workloadApplications = await Application.create(workloadFixture.flatMap(([officer, count, timestamp]) =>
    Array.from({ length: count }, (_, index) => ({
      applicantId: applicant._id,
      applicationType: 'Assignment workload fixture',
      applicationData: {
        title: `Pending workload ${officer.displayName} ${index}`,
        applicantName: applicant.displayName,
        contactEmail: applicant.email,
        details: 'Assignment selection fixture.',
      },
      status: 'ASSIGNED',
      departmentId: agriculture._id,
      assignedOfficerId: officer._id,
      assignedAt: new Date(timestamp + index),
    })),
  ))
  applications.push(...workloadApplications.map(({ _id }) => _id))
  const completedAssignment = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Completed assignment history fixture',
    applicationData: {
      title: 'Completed historical assignment',
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Completed assignments must not count as pending workload.',
    },
    status: 'APPROVED',
    departmentId: agriculture._id,
    assignedOfficerId: officerD._id,
    assignedAt: new Date(3_000),
  })
  applications.push(completedAssignment._id)

  const initialPendingCounts = await Promise.all([officerA, officerB, officerC, officerD].map((officer) =>
    Application.countDocuments({
      assignedOfficerId: officer._id,
      status: { $in: ['ASSIGNED', 'UNDER_REVIEW'] },
    }),
  ))
  assert.deepEqual(initialPendingCounts, [5, 2, 7, 2])

  responseClassification = {
    documentType: 'Income Certificate',
    department: agriculture.code,
    confidence: 0.94,
  }
  const firstAgriculture = await makeDraft('Agriculture assignment tie')
  await addDocument(firstAgriculture, { filename: 'agriculture-first.pdf' })
  const firstAssignment = await submit(firstAgriculture)
  assert.equal(firstAssignment.status, 'ASSIGNED')
  assert.equal(firstAssignment.assignedOfficerName, officerB.displayName)
  let storedFirst = await Application.findById(firstAgriculture._id).lean()
  assert.equal(String(storedFirst.assignedOfficerId), String(officerB._id))
  assert.equal(storedFirst.assignedAt instanceof Date, true)

  const secondAgriculture = await makeDraft('Agriculture assignment updated workload')
  await addDocument(secondAgriculture, { filename: 'agriculture-second.pdf' })
  const secondAssignment = await submit(secondAgriculture)
  assert.equal(secondAssignment.assignedOfficerName, officerD.displayName)
  storedFirst = await Application.findById(secondAgriculture._id).lean()
  assert.equal(String(storedFirst.assignedOfficerId), String(officerD._id))

  responseClassification = {
    documentType: 'Revenue Certificate',
    department: revenue.code,
    confidence: 0.94,
  }
  const revenueApplication = await makeDraft('Revenue department isolation')
  await addDocument(revenueApplication, { filename: 'revenue-isolation.pdf' })
  const revenueAssignment = await submit(revenueApplication)
  assert.equal(revenueAssignment.assignedOfficerName, revenueOfficer.displayName)
  const storedRevenue = await Application.findById(revenueApplication._id).lean()
  assert.equal(String(storedRevenue.departmentId), String(revenue._id))
  assert.equal(String(storedRevenue.assignedOfficerId), String(revenueOfficer._id))
})

test('automatic workload balancing recalculates the lowest workload after every assignment', async () => {
  const department = await Department.create({
    name: `Automatic Workload Balance Department ${runId}`,
    code: `AUTO_BAL_${runId}`,
    isActive: true,
  })
  departments.push(department)
  const passwordHash = await bcrypt.hash('AssignmentFixturePassword!', 10)
  const officers = await User.create(
    ['A', 'B', 'C'].map((suffix) => ({
      email: `auto-balance-${suffix}-${runId}@example.test`,
      displayName: `Balance Officer ${suffix}`,
      passwordHash,
      role: 'OFFICER',
      departmentId: String(department._id),
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
    })),
  )
  users.push(...officers)
  const [officerA, officerB, officerC] = officers
  for (const [officer, count] of [[officerA, 5], [officerB, 2], [officerC, 7]]) {
    const workload = await Application.create(Array.from({ length: count }, (_, index) => ({
      applicantId: applicant._id,
      applicationType: 'Workload balancing fixture',
      applicationData: {
        title: `Balance workload ${officer.displayName} ${index}`,
        applicantName: applicant.displayName,
        contactEmail: applicant.email,
        details: 'Workload balancing integration fixture.',
      },
      status: 'ASSIGNED',
      departmentId: department._id,
      assignedOfficerId: officer._id,
      assignedAt: new Date(Date.now() - (count - index) * 1000),
    })))
    applications.push(...workload.map(({ _id }) => _id))
  }
  responseClassification = {
    documentType: 'Income Certificate',
    department: department.code,
    confidence: 0.94,
  }

  const first = await makeDraft('Workload balancing first submission')
  await addDocument(first, { filename: 'workload-first.pdf' })
  const firstResult = await submit(first)
  assert.equal(String(firstResult.assignedOfficerId), String(officerB._id))

  const second = await makeDraft('Workload balancing second submission')
  await addDocument(second, { filename: 'workload-second.pdf' })
  const secondResult = await submit(second)
  assert.equal(String(secondResult.assignedOfficerId), String(officerB._id))
  assert.deepEqual(await Promise.all([officerA, officerB, officerC].map((officer) =>
    Application.countDocuments({
      assignedOfficerId: officer._id,
      status: { $in: ['ASSIGNED', 'UNDER_REVIEW'] },
    }),
  )), [5, 4, 7])
})

test('OCR confidence 80 passes directly to classification without quality assessment', async () => {
  responseQuality = {
    ...responseQuality,
    documentType: 'Income Certificate',
    qualityScore: '0.94',
    fieldCompleteness: '0.92',
    ocrNoiseScore: '0.08',
  }
  responseClassification = {
    documentType: 'Income Certificate',
    department: targetDepartment.code,
    confidence: 0.94,
  }
  const application = await makeDraft('Good OCR confidence')
  await addDocument(application, {
    filename: 'confidence-80.pdf',
    status: 'COMPLETED',
    confidence: 80,
    threshold: 75,
  })
  const qualityCallsBefore = qualityProviderCallCount
  const classificationCallsBefore = classificationProviderCallCount
  const submitted = await submit(application)
  const qualityStored = await Document.findOne({ applicationId: application._id })
    .select('+qualityAssessment +qualityAssessment.fields')
    .lean()
  assert.equal(submitted.status, 'ASSIGNED')
  assert.equal(submitted.department, targetDepartment.name)
  assert.equal(qualityStored.qualityAssessment, null)
  assert.equal(qualityProviderCallCount, qualityCallsBefore)
  assert.equal(classificationProviderCallCount, classificationCallsBefore + 1)
})

for (const confidence of [75, 90]) {
  test(`OCR confidence ${confidence} skips quality assessment and calls classification`, async () => {
    responseStatus = 200
    responseClassification = {
      documentType: 'Income Certificate',
      department: targetDepartment.code,
      confidence: 0.94,
    }
    const application = await makeDraft(`High confidence ${confidence}`)
    await addDocument(application, {
      filename: `confidence-${confidence}.pdf`,
      confidence,
      status: 'COMPLETED',
      threshold: 75,
    })
    const qualityCallsBefore = qualityProviderCallCount
    const classificationCallsBefore = classificationProviderCallCount
    const submitted = await submit(application)
    assert.equal(submitted.status, 'ASSIGNED')
    assert.equal(qualityProviderCallCount, qualityCallsBefore)
    assert.equal(classificationProviderCallCount, classificationCallsBefore + 1)
  })
}

function healthQuality(overrides = {}) {
  return {
    documentType: 'Health Certificate',
    isReadable: true,
    qualityScore: 0.94,
    fieldCompleteness: 0.92,
    ocrNoiseScore: 0.08,
    safeForAutomation: true,
    reason: 'The OCR text is coherent and certificate details are identifiable.',
    consistency: 'CONSISTENT',
    fields: [
      { name: 'patientName', status: 'CLEAR', confidence: 0.98, value: 'Automatic Applicant', evidence: 'Patient: Automatic Applicant' },
      { name: 'certificateNumber', status: 'CLEAR', confidence: 0.98, value: 'HC-2401', evidence: 'Certificate No: HC-2401' },
      { name: 'issueDate', status: 'CLEAR', confidence: 0.97, value: '2026-10-01', evidence: 'Date: 2026-10-01' },
      { name: 'issuingDoctor', status: 'CLEAR', confidence: 0.98, value: 'Dr Rao', evidence: 'Doctor: Dr Rao' },
      { name: 'healthInstitution', status: 'CLEAR', confidence: 0.98, value: 'City Hospital', evidence: 'Hospital: City Hospital' },
      { name: 'certificationPurpose', status: 'MISSING', confidence: 0.4, value: null, evidence: null },
    ],
    ...overrides,
  }
}

function healthCertificateText() {
  return [
    'HEALTH CERTIFICATE',
    'Patient: Automatic Applicant',
    'Certificate No: HC-2401',
    'Date: 2026-10-01',
    'Doctor: Dr Rao',
    'Hospital: City Hospital',
    'This certificate records the health assessment for administrative purposes.',
  ].join('\n')
}

test('OCR confidence 68 continues only after good AI quality and verified field evidence', async () => {
  responseQuality = healthQuality()
  responseClassification = {
    documentType: 'Health Certificate',
    department: targetDepartment.code,
    confidence: 0.94,
  }
  const application = await makeDraft('Moderate OCR health certificate')
  const officers = users.slice(1, 3)
  const workloadBefore = await Promise.all(officers.map(({ _id }) =>
    Application.countDocuments({
      assignedOfficerId: _id,
      status: { $in: ['ASSIGNED', 'UNDER_REVIEW'] },
    }),
  ))
  await addDocument(application, {
    filename: 'health-certificate.pdf',
    text: healthCertificateText(),
    status: 'LOW_CONFIDENCE',
    confidence: 68,
    threshold: 75,
  })

  const qualityCallsBefore = qualityProviderCallCount
  const classificationCallsBefore = classificationProviderCallCount
  const submitted = await submit(application)
  const stored = await Application.findById(application._id).lean()
  const document = await Document.findOne({ applicationId: application._id })
    .select('+qualityAssessment +qualityAssessment.fields')
    .lean()

  assert.equal(submitted.status, 'ASSIGNED')
  assert.equal(submitted.processingDecision, 'AUTO_PROCESSED')
  assert.equal(stored.processingDecision, 'AUTO_PROCESSED')
  assert.ok(officers.some(({ _id }) => String(_id) === String(stored.assignedOfficerId)))
  assert.equal(document.ocrQualityMetrics.textLength, healthCertificateText().length)
  assert.equal(document.qualityAssessment.status, 'PASS')
  assert.equal(document.qualityAssessment.modelFieldCompleteness, 0.92)
  assert.ok(document.qualityAssessment.verifiedFieldCompleteness >= 0.8)
  assert.equal(document.qualityAssessment.band, 'MODERATE_CONFIDENCE')
  assert.deepEqual(
    document.qualityAssessment.fields.map(({ name }) => name),
    healthQuality().fields.map(({ name }) => name),
  )
  assert.equal(submitted.department, targetDepartment.name)
  assert.equal(qualityProviderCallCount, qualityCallsBefore + 1)
  assert.equal(classificationProviderCallCount, classificationCallsBefore + 1)
  const workloadAfter = await Promise.all(officers.map(({ _id }) =>
    Application.countDocuments({
      assignedOfficerId: _id,
      status: { $in: ['ASSIGNED', 'UNDER_REVIEW'] },
    }),
  ))
  const selectedIndex = officers.findIndex(({ _id }) =>
    String(_id) === String(stored.assignedOfficerId),
  )
  assert.notEqual(selectedIndex, -1)
  assert.equal(workloadAfter[selectedIndex], workloadBefore[selectedIndex] + 1)
  assert.equal(workloadBefore[selectedIndex], Math.min(...workloadBefore))
  responseClassification = {
    documentType: 'Health Certificate',
    department: 'Revenue',
    confidence: 0.94,
  }
})

test('OCR confidence 68 with unsafe quality stays in Human Verification', async () => {
  responseQuality = healthQuality({ qualityScore: 0.6 })
  responseClassification = {
    documentType: 'Health Certificate',
    department: targetDepartment.code,
    confidence: 0.94,
  }
  const application = await makeDraft('Low AI quality')
  await addDocument(application, {
    filename: 'low-quality-health.pdf',
    text: healthCertificateText(),
    status: 'LOW_CONFIDENCE',
    confidence: 68,
    threshold: 75,
  })
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_DOCUMENT_QUALITY_LOW')
  assert.equal(submitted.verificationReasons[0].qualityScore, 0.6)
})

for (const confidence of [60, 74.99]) {
  test(`OCR confidence ${confidence} runs quality assessment then classification and assignment`, async () => {
    responseQuality = healthQuality()
    responseClassification = {
      documentType: 'Health Certificate',
      department: targetDepartment.code,
      confidence: 0.94,
    }
    const application = await makeDraft(`Quality recovery ${confidence}`)
    await addDocument(application, {
      filename: `quality-recovery-${confidence}.pdf`,
      text: healthCertificateText(),
      status: 'LOW_CONFIDENCE',
      confidence,
      threshold: 75,
    })
    const qualityCallsBefore = qualityProviderCallCount
    const classificationCallsBefore = classificationProviderCallCount
    const submitted = await submit(application)
    assert.equal(submitted.status, 'ASSIGNED')
    assert.equal(submitted.department, targetDepartment.name)
    assert.equal(qualityProviderCallCount, qualityCallsBefore + 1)
    assert.equal(classificationProviderCallCount, classificationCallsBefore + 1)
  })
}

test('missing document fields at moderate OCR confidence enter Human Verification', async () => {
  responseQuality = healthQuality({ fields: [] })
  responseClassification = {
    documentType: 'Health Certificate',
    department: targetDepartment.code,
    confidence: 0.94,
  }
  const application = await makeDraft('Missing health certificate fields')
  await addDocument(application, {
    filename: 'missing-health-fields.pdf',
    text: healthCertificateText(),
    status: 'LOW_CONFIDENCE',
    confidence: 70,
    threshold: 75,
  })
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'INSUFFICIENT_FIELDS')
  assert.equal(submitted.verificationReasons[0].fieldCompleteness, 0)
  responseClassification = {
    documentType: 'Health Certificate',
    department: 'Revenue',
    confidence: 0.94,
  }
})

for (const confidence of [59.99, 40]) {
  test(`OCR confidence ${confidence} runs AI quality assessment then keeps the safe-floor fallback`, async () => {
    const application = await makeDraft(`Below low-confidence floor ${confidence}`)
    await addDocument(application, {
      filename: `ocr-${confidence}.pdf`,
      text: healthCertificateText(),
      status: 'LOW_CONFIDENCE',
      confidence,
      threshold: 75,
    })
    const qualityCallsBefore = qualityProviderCallCount
    const classificationCallsBefore = classificationProviderCallCount
    const submitted = await submit(application)
    assert.equal(submitted.status, 'HUMAN_VERIFICATION')
    assert.equal(submitted.verificationReasons[0].code, 'OCR_BELOW_MINIMUM_SAFE')
    assert.match(submitted.verificationReasons[0].message, /minimum safe processing score of 60%/)
    assert.equal(qualityProviderCallCount, qualityCallsBefore + 1)
    assert.equal(classificationProviderCallCount, classificationCallsBefore)
  })
}

test('severely noisy OCR runs quality assessment then enters Human Verification without classification', async () => {
  const application = await makeDraft('Severely noisy OCR')
  const noisyText = `${'�###@@@@ '.repeat(30)} ${'UNREADABLE TEXT '.repeat(20)}`
  await addDocument(application, {
    filename: 'severely-noisy.pdf',
    text: noisyText,
    status: 'LOW_CONFIDENCE',
    confidence: 70,
    threshold: 75,
  })
  const callsBeforeSubmit = providerCallCount
  const qualityCallsBefore = qualityProviderCallCount
  const classificationCallsBefore = classificationProviderCallCount
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_DOCUMENT_QUALITY_LOW')
  assert.match(submitted.verificationReasons[0].failureDescription, /Deterministic OCR quality metrics/)
  assert.equal(providerCallCount, callsBeforeSubmit + 1)
  assert.equal(qualityProviderCallCount, qualityCallsBefore + 1)
  assert.equal(classificationProviderCallCount, classificationCallsBefore)
})

test('classification confidence below the configured minimum cannot route automatically', async () => {
  responseQuality = { ...responseQuality, documentType: 'Income Certificate' }
  responseClassification = {
    documentType: 'Income Certificate',
    department: targetDepartment.code,
    confidence: 0.89,
  }
  const application = await makeDraft('Low classification confidence')
  await addDocument(application, { filename: 'low-classification-confidence.pdf' })

  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.processingDecision, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'LOW_CLASSIFICATION_CONFIDENCE')
  responseClassification = {
    documentType: 'Income Certificate',
    department: 'Revenue',
    confidence: 0.94,
  }
})

test('OCR failure skips classification and preserves its safe failure reason', async () => {
  const application = await makeDraft('OCR processing failed')
  await addDocument(application, {
    filename: 'failed-document.pdf',
    text: null,
    status: 'FAILED',
    confidence: null,
    threshold: null,
    failureCode: 'OCR_PROCESSING_FAILED',
  })
  const callsBeforeSubmit = providerCallCount
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'OCR_PROCESSING_FAILED')
  assert.equal(submitted.verificationReasons[0].failureCode, 'OCR_PROCESSING_FAILED')
  assert.equal(providerCallCount, callsBeforeSubmit)
})

test('OCR failure takes precedence when another document in the application OCRs successfully', async () => {
  responseStatus = 503
  const application = await makeDraft('Mixed OCR results')
  await addDocument(application, {
    filename: 'failed-document.pdf',
    text: null,
    status: 'FAILED',
    confidence: null,
    threshold: null,
    failureCode: 'OCR_PROCESSING_FAILED',
  })
  await addDocument(application, { filename: 'readable-document.pdf' })
  const callsBeforeSubmit = providerCallCount
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(providerCallCount, callsBeforeSubmit)
  assert.deepEqual(submitted.verificationReasons.map(({ documentName }) => documentName), ['failed-document.pdf'])
  responseStatus = 200
})

test('insufficient OCR text is sent to Human Verification before provider invocation', async () => {
  const application = await makeDraft('Insufficient text')
  await addDocument(application, { filename: 'blank-scan.pdf', text: '   ' })
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'INSUFFICIENT_OCR_TEXT')
})

test('provider failure creates an AI_CLASSIFICATION_FAILED reason', async () => {
  responseStatus = 503
  const application = await makeDraft('Classifier unavailable')
  const document = await addDocument(application, { filename: 'provider-failure.pdf' })
  const submitted = await submit(application)
  responseStatus = 200
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_CLASSIFICATION_FAILED')
  assert.equal(submitted.verificationReasons[0].documentId, String(document._id))
  assert.match(submitted.verificationReasons[0].failureDescription, /HTTP 503/)
  assert.doesNotMatch(submitted.verificationReasons[0].failureDescription, /token|Bearer|stack/i)
})

test('quality provider failure at OCR 68% requires Human Verification without classification', async () => {
  responseStatus = 503
  const application = await makeDraft('Quality provider unavailable')
  await addDocument(application, {
    filename: 'quality-provider-failure.pdf',
    text: healthCertificateText(),
    status: 'LOW_CONFIDENCE',
    confidence: 68,
    threshold: 75,
  })
  const qualityCallsBefore = qualityProviderCallCount
  const classificationCallsBefore = classificationProviderCallCount
  const submitted = await submit(application)
  responseStatus = 200
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_DOCUMENT_QUALITY_LOW')
  assert.match(submitted.verificationReasons[0].failureDescription, /quality assessment could not be completed safely/)
  assert.equal(qualityProviderCallCount, qualityCallsBefore + 1)
  assert.equal(classificationProviderCallCount, classificationCallsBefore)
})

test('OCR 90% classifier works while quality provider is unavailable', async () => {
  responseStatus = 503
  classificationResponseStatus = 200
  responseClassification = {
    documentType: 'Income Certificate',
    department: targetDepartment.code,
    confidence: 0.94,
  }
  const application = await makeDraft('Classification while quality provider is unavailable')
  await addDocument(application, {
    filename: 'classification-with-quality-outage.pdf',
    confidence: 90,
    status: 'COMPLETED',
    threshold: 75,
  })
  const qualityCallsBefore = qualityProviderCallCount
  const classificationCallsBefore = classificationProviderCallCount
  const submitted = await submit(application)
  responseStatus = 200
  classificationResponseStatus = null
  assert.equal(submitted.status, 'ASSIGNED')
  assert.equal(qualityProviderCallCount, qualityCallsBefore)
  assert.equal(classificationProviderCallCount, classificationCallsBefore + 1)
})

test('classification provider failure after quality pass stays in Human Verification', async () => {
  responseStatus = 200
  classificationResponseStatus = 503
  const application = await makeDraft('Classifier unavailable after quality pass')
  await addDocument(application, { filename: 'classification-provider-failure.pdf' })
  const submitted = await submit(application)
  classificationResponseStatus = null
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_CLASSIFICATION_FAILED')
  assert.match(submitted.verificationReasons[0].failureDescription, /HTTP 503/)
})

test('missing provider configuration falls back without claiming classification succeeded', async () => {
  const previousEndpoint = env.AI_CLASSIFICATION_API_URL
  env.AI_CLASSIFICATION_API_URL = ''
  const application = await makeDraft('Classifier not configured')
  await addDocument(application, { filename: 'unconfigured-provider.pdf' })
  const submitted = await submit(application)
  env.AI_CLASSIFICATION_API_URL = previousEndpoint
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_CLASSIFICATION_FAILED')
  assert.match(submitted.verificationReasons[0].failureDescription, /not configured/)
})

test('malformed provider output cannot be treated as a successful classification', async () => {
  responseStatus = 200
  responseClassification = 'not structured classification JSON'
  const application = await makeDraft('Malformed classifier response')
  await addDocument(application, { filename: 'malformed-classification.pdf' })
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_CLASSIFICATION_FAILED')
  responseClassification = {
    documentType: 'Income Certificate',
    department: 'Revenue',
    confidence: 0.94,
  }
})

test('malformed AI quality response falls back without calling classification', async () => {
  responseQuality = 'invalid quality data'
  const application = await makeDraft('Malformed AI quality response')
  await addDocument(application, {
    filename: 'malformed-quality.pdf',
    text: healthCertificateText(),
    status: 'LOW_CONFIDENCE',
    confidence: 68,
    threshold: 75,
  })
  const submitted = await submit(application)
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.equal(submitted.verificationReasons[0].code, 'AI_DOCUMENT_QUALITY_LOW')
  responseQuality = {
    documentType: 'Income Certificate',
    isReadable: true,
    qualityScore: 0.94,
    fieldCompleteness: 0.92,
    ocrNoiseScore: 0.08,
    safeForAutomation: true,
    reason: 'The OCR text is coherent and identifies the certificate.',
    consistency: 'CONSISTENT',
    fields: [],
  }
})

test('unknown and invalid department outputs use distinct structured fallback reasons', async () => {
  const unknownApplication = await makeDraft('Unknown department')
  await addDocument(unknownApplication, { filename: 'unknown-department.pdf' })
  responseClassification = { documentType: 'Record', department: null, confidence: 0.91 }
  const unknown = await submit(unknownApplication)
  assert.equal(unknown.status, 'HUMAN_VERIFICATION')
  assert.equal(unknown.verificationReasons[0].code, 'UNKNOWN_DEPARTMENT')

  const invalidApplication = await makeDraft('Invalid department')
  await addDocument(invalidApplication, { filename: 'invalid-department.pdf' })
  responseClassification = { documentType: 'Record', department: 'Imaginary Ministry', confidence: 0.91 }
  const invalid = await submit(invalidApplication)
  assert.equal(invalid.status, 'HUMAN_VERIFICATION')
  assert.equal(invalid.verificationReasons[0].code, 'INVALID_AI_CLASSIFICATION')
  responseClassification = {
    documentType: 'Income Certificate',
    department: 'Revenue',
    confidence: 0.94,
  }
})

test('conflicting multi-document classifications fall back with reasons for each document', async () => {
  const secondDepartment = await Department.create({
    name: `Automatic Second Department ${runId}`,
    code: `AUTO_SECOND_${runId}`,
    isActive: true,
  })
  departments.push(secondDepartment)
  const application = await makeDraft('Conflicting document departments')
  await addDocument(application, { filename: 'revenue-record.pdf' })
  await addDocument(application, { filename: 'second-record.pdf' })
  let calls = 0
  const submitted = await submitApplicantApplication({
    id: String(applicant._id),
    role: 'APPLICANT',
    permissions: ['APPLICATION_CREATE'],
  }, String(application._id), {
    assessDocumentQuality: async () => ({
      documentType: 'Government record',
      isReadable: true,
      qualityScore: 0.94,
      fieldCompleteness: 0.92,
      ocrNoiseScore: 0.08,
      safeForAutomation: true,
      reason: 'Readable document.',
      consistency: 'CONSISTENT',
      fields: [],
    }),
    classifyDocument: async () => ({
      documentType: 'Government record',
      department: calls++ === 0 ? targetDepartment.code : secondDepartment.name,
      confidence: 0.9,
    }),
  })
  assert.equal(submitted.status, 'HUMAN_VERIFICATION')
  assert.deepEqual(
    submitted.verificationReasons.map(({ code }) => code),
    ['CONFLICTING_CLASSIFICATIONS', 'CONFLICTING_CLASSIFICATIONS'],
  )
})

test('automatic assignment uses WAITING_FOR_OFFICER_ASSIGNMENT when department has no eligible officer', async () => {
  responseClassification = {
    documentType: 'Unstaffed Department Form',
    department: departments[1].name,
    confidence: 0.9,
  }
  responseQuality = {
    ...responseQuality,
    documentType: 'Unstaffed Department Form',
  }
  const application = await makeDraft('Department without officers')
  await addDocument(application, { filename: 'unassigned.pdf' })
  const submitted = await submit(application)
  const stored = await Application.findById(application._id).lean()
  const reloaded = await getApplicantApplication(String(applicant._id), String(application._id))
  assert.equal(submitted.status, 'WAITING_FOR_OFFICER_ASSIGNMENT')
  assert.equal(reloaded.status, 'WAITING_FOR_OFFICER_ASSIGNMENT')
  assert.equal(submitted.assignedOfficerId, null)
  assert.equal(stored.assignedOfficerId, null)
  assert.equal(stored.assignedAt, null)
  assert.equal(String(stored.departmentId), String(departments[1]._id))
  const assignmentAudit = await mongoose.connection.collection('auditevents').findOne({
    applicationId: application._id,
    action: 'APPLICATION_AUTOMATICALLY_WAITING_FOR_OFFICER',
  })
  assert.match(assignmentAudit.reason, /No eligible active officer is currently available/)

  await Application.updateOne(
    { _id: application._id },
    { $set: { status: 'WAITING_FOR_OFFICER' } },
  )
  const stillWaiting = await retryWaitingApplicationAssignment(
    String(application._id),
    { id: String(applicant._id), role: 'ADMIN' },
  )
  assert.equal(stillWaiting.application.status, 'WAITING_FOR_OFFICER_ASSIGNMENT')
  assert.equal(stillWaiting.assignedOfficer, null)
  const migratedWaitingApplication = await Application.findById(application._id).lean()
  assert.equal(migratedWaitingApplication.status, 'WAITING_FOR_OFFICER_ASSIGNMENT')

  const officer = await User.create({
    email: `auto-late-officer-${runId}@example.test`,
    displayName: 'Newly Available Officer',
    passwordHash: await bcrypt.hash('AssignmentFixturePassword!', 10),
    role: 'OFFICER',
    departmentId: String(departments[1]._id),
    accountStatus: 'ACTIVE',
    isActive: true,
    mustChangePassword: false,
  })
  users.push(officer)
  const retried = await retryWaitingApplicationAssignment(
    String(application._id),
    { id: String(applicant._id), role: 'ADMIN' },
  )
  assert.equal(retried.application.status, 'ASSIGNED')
  assert.equal(retried.assignedOfficer, String(officer._id))
  const reassigned = await Application.findById(application._id).lean()
  assert.equal(reassigned.status, 'ASSIGNED')
  assert.equal(String(reassigned.assignedOfficerId), String(officer._id))
  assert.ok(reassigned.assignedAt instanceof Date)
  responseQuality = { ...responseQuality, documentType: 'Income Certificate' }
})

test('admin overview reports persisted automation and field-evidence rates', async () => {
  const overview = await getAdminOverview()
  assert.ok(overview.automationMetrics.autoProcessedCount >= 1)
  assert.ok(overview.automationMetrics.humanVerificationCount >= 1)
  assert.ok(overview.automationMetrics.decisionedApplicationCount >= 2)
  assert.ok(overview.automationMetrics.automationRate >= 0)
  assert.ok(overview.automationMetrics.requiredFieldCount >= 4)
  assert.ok(overview.automationMetrics.completeFieldCount >= 2)
  assert.ok(overview.automationMetrics.evidenceSupportedFieldCount >= 2)
  assert.ok(overview.automationMetrics.confidenceQualifiedFieldCount >= 2)
})

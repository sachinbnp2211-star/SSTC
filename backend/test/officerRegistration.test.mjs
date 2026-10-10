import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'

import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { signToken } from '../src/middleware/auth.mjs'
import Application from '../src/models/Application.mjs'
import AuditEvent from '../src/models/AuditEvent.mjs'
import Department from '../src/models/Department.mjs'
import GovernmentOfficerRegistry from '../src/models/GovernmentOfficerRegistry.mjs'
import RevokedToken from '../src/models/RevokedToken.mjs'
import User from '../src/models/User.mjs'
import { configureOfficerEmailSender } from '../src/services/emailService.mjs'

const runId = `${process.pid}-${Date.now()}`
const testOfficerIds = ['REV-891', 'REV-892', 'REV-893', 'REV-894', 'REV-895', 'REV-896', 'REV-897', 'REV-898']
const testEmails = []
const testTokenIds = []
let server
let baseUrl
let department
let admin
let adminToken
let applicant
let applicantToken
let existingOfficer
let existingOfficerToken

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run Officer registration integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for Officer registration integration tests.')
  await GovernmentOfficerRegistry.init()
  await User.init()

  const departmentCode = `OR${String(Date.now()).slice(-5)}`
  department = await Department.create({
    name: `Officer Registration Test Department ${runId}`,
    code: departmentCode,
    isActive: true,
  })

  await GovernmentOfficerRegistry.deleteMany({ governmentOfficerId: { $in: testOfficerIds } })
  await GovernmentOfficerRegistry.create(testOfficerIds.map((governmentOfficerId, index) => ({
    governmentOfficerId,
    displayName: `Demo Officer ${index + 891}`,
    departmentId: String(department._id),
    officialEmail: `demo.${governmentOfficerId.toLowerCase()}@officers.example.test`,
    isActive: governmentOfficerId !== 'REV-892',
  })))

  const passwordHash = await bcrypt.hash('ExistingPassword123!', 10)
  admin = await User.create({
    email: `officer-approval-admin-${runId}@example.test`,
    displayName: 'Officer Approval Admin',
    passwordHash,
    role: 'ADMIN',
    permissions: ['ORG_OVERVIEW', 'USER_MANAGE', 'DEPARTMENT_MANAGE'],
    isActive: true,
    accountStatus: 'ACTIVE',
  })
  applicant = await User.create({
    email: `officer-approval-applicant-${runId}@example.test`,
    displayName: 'Officer Approval Applicant',
    passwordHash,
    role: 'APPLICANT',
    permissions: ['APPLICATION_CREATE'],
    isActive: true,
  })
  existingOfficer = await User.create({
    email: `officer-approval-existing-${runId}@example.test`,
    displayName: 'Existing Officer',
    passwordHash,
    role: 'OFFICER',
    accountStatus: 'ACTIVE',
    departmentId: String(department._id),
    governmentOfficerId: `MOK-${String(Date.now()).slice(-3)}`,
    permissions: ['APPLICATION_VIEW_ASSIGNED'],
    isActive: true,
  })
  testEmails.push(admin.email, applicant.email, existingOfficer.email)
  adminToken = signToken({
    id: String(admin._id),
    role: admin.role,
    permissions: admin.permissions,
  })
  applicantToken = signToken({
    id: String(applicant._id),
    role: applicant.role,
    permissions: applicant.permissions,
  })
  existingOfficerToken = signToken({
    id: String(existingOfficer._id),
    role: existingOfficer.role,
    permissions: existingOfficer.permissions,
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
  await User.deleteMany({
    $or: [
      { email: { $in: testEmails } },
      { governmentOfficerId: { $in: testOfficerIds } },
    ],
  })
  await GovernmentOfficerRegistry.deleteMany({ governmentOfficerId: { $in: testOfficerIds } })
  if (department) await Department.deleteOne({ _id: department._id })
  if (testTokenIds.length) await RevokedToken.deleteMany({ tokenId: { $in: testTokenIds } })
  if (admin) {
    await mongoose.connection.collection('auditevents').deleteMany({
      actorId: admin._id,
      action: { $in: [
        'OFFICER_REGISTRATION_APPROVED',
        'OFFICER_REGISTRATION_REJECTED',
        'GENERAL_OFFICER_REGISTRATION_SUBMITTED',
        'GENERAL_OFFICER_REGISTRATION_APPROVED',
        'GENERAL_OFFICER_REGISTRATION_REJECTED',
      ] },
    })
  }
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

function headers(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function registryDetails(governmentOfficerId) {
  const sequence = Number(governmentOfficerId.slice(-3))
  return {
    governmentOfficerId,
    displayName: `Demo Officer ${sequence}`,
    email: `demo.${governmentOfficerId.toLowerCase()}@officers.example.test`,
  }
}

async function registerOfficer(governmentOfficerId, overrides = {}) {
  return fetch(`${baseUrl}/api/auth/officer-registration`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ...registryDetails(governmentOfficerId), ...overrides }),
  })
}

async function registerOfficerById(governmentOfficerId) {
  return fetch(`${baseUrl}/api/auth/officer-registration`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ governmentOfficerId }),
  })
}

async function login(identifier, password) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ identifier, password }),
  })
}

test('valid registry identity creates a pending Officer using the registry Department', async () => {
  const response = await registerOfficer('REV-891')
  const body = await response.json()
  assert.equal(response.status, 201)
  assert.equal(body.status, 'PENDING')
  assert.equal(body.user.accountStatus, 'PENDING')
  assert.equal(body.user.role, 'OFFICER')
  assert.equal(body.user.departmentId, String(department._id))
  assert.equal(body.department.name, department.name)
  assert.equal(body.user.isActive, false)
  assert.equal('passwordHash' in body.user, false)
  assert.equal(typeof body.registrationAccessToken, 'string')
  assert.equal('registrationAccessToken' in body.user, false)

  const stored = await User.findById(body.user.id)
    .select('+registrationAccessTokenHash +registrationAccessTokenExpiresAt').lean()
  assert.equal(stored.departmentId, String(department._id))
  assert.equal(stored.passwordHash, undefined)
  assert.equal(stored.registrationAccessTokenHash, createHash('sha256').update(body.registrationAccessToken).digest('hex'))
  assert.notEqual(stored.registrationAccessTokenHash, body.registrationAccessToken)
  assert.ok(stored.registrationAccessTokenExpiresAt > new Date())
  assert.equal((await login('REV-891', 'AnyPassword123!')).status, 403)

  const duplicate = await registerOfficer('REV-891')
  assert.equal(duplicate.status, 409)
  assert.match((await duplicate.json()).error, /awaiting administrator approval/i)
  const duplicateLookup = await fetch(`${baseUrl}/api/auth/officer-registration/validate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ governmentOfficerId: 'REV-891' }),
  })

  assert.equal(duplicateLookup.status, 409)
  assert.equal((await duplicateLookup.json()).error, 'Your registration is already awaiting administrator approval.')
})

test('General Officer registration requires Admin approval and one-time password setup', async () => {
  const registrationResponse = await fetch(`${baseUrl}/api/auth/officer-registration`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ role: 'GENERAL_OFFICER', governmentOfficerId: 'REV-898' }),
  })
  const registration = await registrationResponse.json()
  assert.equal(registrationResponse.status, 201)
  assert.equal(registration.user.role, 'GENERAL_OFFICER')
  assert.equal(registration.user.accountStatus, 'PENDING')
  assert.equal(registration.user.email, 'demo.rev-898@officers.example.test')
  assert.equal(registration.user.departmentId, String(department._id))
  assert.equal('passwordHash' in registration.user, false)

  const pendingLogin = await login('REV-898', 'AnyPassword123!')
  assert.equal(pendingLogin.status, 403)
  assert.match((await pendingLogin.json()).error, /awaiting Admin approval/i)

  const accessHeaders = headers(registration.registrationAccessToken)
  const pendingStatus = await fetch(`${baseUrl}/api/officer/registration/status`, {
    method: 'POST',
    headers: accessHeaders,
    body: JSON.stringify({ role: 'GENERAL_OFFICER', governmentOfficerId: 'REV-898' }),
  })
  assert.equal((await pendingStatus.json()).status, 'PENDING')

  const approval = await fetch(`${baseUrl}/api/admin/officer-registrations/${registration.user.id}/approve`, {
    method: 'POST',
    headers: headers(adminToken),
  })
  assert.equal(approval.status, 200)
  assert.match((await approval.json()).message, /General Officer registration approved/i)

  const approvedStatusResponse = await fetch(`${baseUrl}/api/officer/registration/status`, {
    method: 'POST',
    headers: accessHeaders,
    body: JSON.stringify({ role: 'GENERAL_OFFICER', governmentOfficerId: 'REV-898' }),
  })
  const approvedStatus = await approvedStatusResponse.json()
  assert.equal(approvedStatus.status, 'APPROVED')
  assert.equal(approvedStatus.passwordSetupAvailable, true)
  assert.equal(approvedStatus.passwordSetupUrl, '/general-officer/setup?registration=1&officerId=REV-898')

  const setup = await fetch(`${baseUrl}/api/officer/registration/setup`, {
    method: 'POST',
    headers: accessHeaders,
    body: JSON.stringify({
      role: 'GENERAL_OFFICER',
      governmentOfficerId: 'REV-898',
      temporaryPassword: 'GeneralOfficerPassword123!',
    }),
  })
  assert.equal(setup.status, 200)
  assert.equal((await setup.json()).user.role, 'GENERAL_OFFICER')

  const emailLogin = await login(registration.user.email, 'GeneralOfficerPassword123!')
  assert.equal(emailLogin.status, 401)

  const activeLogin = await login('REV-898', 'GeneralOfficerPassword123!')
  assert.equal(activeLogin.status, 200)
  assert.equal((await activeLogin.json()).user.role, 'GENERAL_OFFICER')
})

test('production approval sends setup email without returning preview references or setup tokens', async () => {
  const registration = await registerOfficer('REV-896')
  assert.equal(registration.status, 201)
  const pending = (await registration.json()).user
  const previousNodeEnv = env.NODE_ENV
  const sentMessages = []
  env.NODE_ENV = 'production'
  configureOfficerEmailSender(async (message) => {
    sentMessages.push(message)
  })

  try {
    const approval = await fetch(`${baseUrl}/api/admin/officer-registrations/${pending.id}/approve`, {
      method: 'POST',
      headers: headers(adminToken),
    })
    assert.equal(approval.status, 200)
    const body = await approval.json()
    assert.equal(body.success, true)
    assert.equal(body.message, 'Officer registration approved successfully. The officer can open their Officer Dashboard to continue password setup.')
    assert.equal('developmentSetupPreviewId' in body, false)
    assert.equal('developmentSetupPath' in body, false)
    assert.equal('passwordHash' in body.user, false)
    assert.doesNotMatch(JSON.stringify(body), /setupPath|token=/i)
    const productionPreview = await fetch(
      `${baseUrl}/api/admin/officer-registrations/${pending.id}/setup-email-preview/unavailable`,
      { headers: headers(adminToken) },
    )
    assert.equal(productionPreview.status, 404)
    assert.equal(sentMessages.length, 1)
    assert.equal(sentMessages[0].to, registryDetails('REV-896').email)
    assert.equal(sentMessages[0].metadata.governmentOfficerId, 'REV-896')
    assert.match(sentMessages[0].setupPath, /^\/officer\/setup\?token=/)
  } finally {
    configureOfficerEmailSender(null)
    env.NODE_ENV = previousNodeEnv
  }
})

test('unknown, inactive, mismatched-name, and mismatched-email registry entries are rejected', async () => {
  assert.equal((await registerOfficer('REV-999')).status, 404)
  assert.equal((await registerOfficer('REV-892')).status, 403)
  assert.equal((await registerOfficer('REV-895', { displayName: 'Different Name' })).status, 400)
  assert.equal((await registerOfficer('REV-895', { email: 'other@example.test' })).status, 400)
  assert.equal(await User.countDocuments({ governmentOfficerId: { $in: ['REV-999', 'REV-892', 'REV-895'] } }), 0)
  const applicantRegistration = await fetch(`${baseUrl}/api/auth/officer-registration`, {
    method: 'POST',
    headers: headers(applicantToken),
    body: JSON.stringify(registryDetails('REV-895')),
  })
  assert.equal(applicantRegistration.status, 403)
})

test('identity validation previews only registry-derived department and never creates an account', async () => {
  const valid = await fetch(`${baseUrl}/api/auth/officer-registration/validate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ governmentOfficerId: 'REV-895' }),
  })
  assert.equal(valid.status, 200)
  const result = await valid.json()
  assert.equal(result.valid, true)
  assert.equal(result.department.name, department.name)
  assert.equal(result.governmentOfficerId, 'REV-895')
  assert.equal(result.displayName, 'Demo Officer 895')
  assert.equal(result.officialEmail, 'demo.rev-895@officers.example.test')
  assert.equal(await User.countDocuments({ governmentOfficerId: 'REV-895' }), 0)

  const invalid = await fetch(`${baseUrl}/api/auth/officer-registration/validate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(registryDetails('REV-999')),
  })
  assert.equal(invalid.status, 404)
  assert.equal((await invalid.json()).error, 'Government Officer ID was not found.')

  const inactive = await fetch(`${baseUrl}/api/auth/officer-registration/validate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ governmentOfficerId: 'REV-892' }),
  })
  assert.equal(inactive.status, 403)
  assert.equal((await inactive.json()).error, 'This Government Officer ID is inactive.')

  const authenticatedApplicant = await fetch(`${baseUrl}/api/auth/officer-registration/validate`, {
    method: 'POST',
    headers: headers(applicantToken),
    body: JSON.stringify({ governmentOfficerId: 'REV-895' }),
  })
  assert.equal(authenticatedApplicant.status, 403)
})

test('only Admin can list, inspect, approve, and reject Officer registrations', async () => {
  await registerOfficer('REV-894')
  for (const token of [applicantToken, existingOfficerToken]) {
    const list = await fetch(`${baseUrl}/api/admin/officer-registrations`, { headers: headers(token) })
    assert.equal(list.status, 403)
    const approve = await fetch(`${baseUrl}/api/admin/officer-registrations/invalid/approve`, {
      method: 'POST',
      headers: headers(token),
    })
    assert.equal(approve.status, 403)
    const reject = await fetch(`${baseUrl}/api/admin/officer-registrations/invalid/reject`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ reason: 'Not approved.' }),
    })
    assert.equal(reject.status, 403)
  }

  const list = await fetch(`${baseUrl}/api/admin/officer-registrations?status=PENDING`, {
    headers: headers(adminToken),
  })
  assert.equal(list.status, 200)
  const registrations = await list.json()
  const pending = registrations.registrations.find(({ governmentOfficerId }) => governmentOfficerId === 'REV-894')
  assert.ok(pending)
  assert.equal('passwordHash' in pending, false)

  const detail = await fetch(`${baseUrl}/api/admin/officer-registrations/${pending.id}`, {
    headers: headers(adminToken),
  })
  assert.equal(detail.status, 200)
  assert.equal((await detail.json()).registration.email, registryDetails('REV-894').email)

  const reject = await fetch(`${baseUrl}/api/admin/officer-registrations/${pending.id}/reject`, {
    method: 'POST',
    headers: headers(adminToken),
    body: JSON.stringify({ reason: 'Registry identity requires revalidation.' }),
  })
  assert.equal(reject.status, 200)
  const rejected = (await reject.json()).registration
  assert.equal(rejected.accountStatus, 'REJECTED')
  assert.equal(rejected.isActive, false)
  assert.equal('passwordHash' in rejected, false)
  assert.equal((await login('REV-894', 'AnyPassword123!')).status, 403)
})

test('rejected registration can be resubmitted without creating another User', async () => {
  const first = await registerOfficer('REV-893')
  assert.equal(first.status, 201)
  const firstBody = await first.json()
  const firstUser = firstBody.user
  const rejected = await fetch(`${baseUrl}/api/admin/officer-registrations/${firstUser.id}/reject`, {
    method: 'POST',
    headers: headers(adminToken),
    body: JSON.stringify({ reason: 'Please submit again.' }),
  })
  assert.equal(rejected.status, 200)
  const rejectedStatus = await fetch(`${baseUrl}/api/officer/registration/status`, {
    method: 'POST',
    headers: headers(firstBody.registrationAccessToken),
    body: JSON.stringify({ governmentOfficerId: 'REV-893' }),
  })
  const rejectedStatusBody = await rejectedStatus.json()
  assert.equal(rejectedStatus.status, 200)
  assert.equal(rejectedStatusBody.status, 'REJECTED')
  assert.equal(rejectedStatusBody.passwordSetupAvailable, false)
  assert.equal(rejectedStatusBody.rejectionReason, 'Please submit again.')
  const publicRejectedStatus = await fetch(`${baseUrl}/api/officer/registration/status`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ governmentOfficerId: 'REV-893' }),
  })
  const publicRejectedStatusBody = await publicRejectedStatus.json()
  assert.equal(publicRejectedStatusBody.status, 'REJECTED')
  assert.equal('rejectionReason' in publicRejectedStatusBody, false)

  const resubmitted = await registerOfficer('REV-893')
  assert.equal(resubmitted.status, 201)
  const resubmittedBody = await resubmitted.json()
  assert.equal(resubmittedBody.reRegistered, true)
  assert.notEqual(resubmittedBody.registrationAccessToken, firstBody.registrationAccessToken)
  assert.equal(await User.countDocuments({ governmentOfficerId: 'REV-893' }), 1)
})

test('Admin approval sends a one-time setup email, consumes its link, and permits ID login afterward', async () => {
  const registration = await registerOfficerById('REV-895')
  assert.equal(registration.status, 201)
  const registrationBody = await registration.json()
  const pending = registrationBody.user
  const sentMessages = []
  configureOfficerEmailSender(async (message) => {
    sentMessages.push(message)
  })
  const approvedResponse = await fetch(`${baseUrl}/api/admin/officer-registrations/${pending.id}/approve`, {
    method: 'POST',
    headers: headers(adminToken),
  })
  assert.equal(approvedResponse.status, 200)
  const approvedBody = await approvedResponse.json()
  assert.equal(approvedBody.success, true)
  assert.equal(approvedBody.user.accountStatus, 'ACTIVE')
  assert.equal(approvedBody.user.isActive, true)
  assert.equal(approvedBody.user.mustChangePassword, true)
  assert.equal('passwordHash' in approvedBody.user, false)
  assert.equal('developmentSetupPreviewId' in approvedBody, false)
  assert.ok(approvedBody.setupExpiresAt)
  assert.doesNotMatch(JSON.stringify(approvedBody), /setupPath|token=/i)
  assert.equal((await login('REV-895', 'NotYetSetPassword123!')).status, 401)
  assert.equal(sentMessages.length, 1)
  assert.equal(sentMessages[0].to, registryDetails('REV-895').email)
  assert.equal(sentMessages[0].metadata.governmentOfficerId, 'REV-895')
  assert.match(sentMessages[0].setupPath, /^\/officer\/setup\?token=/)
  assert.match(sentMessages[0].setupPath, /officerId=REV-895$/)
  const activeDuplicate = await fetch(`${baseUrl}/api/auth/officer-registration/validate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ governmentOfficerId: 'REV-895' }),
  })
  assert.equal(activeDuplicate.status, 409)
  assert.equal((await activeDuplicate.json()).error, 'This officer already has an account.')

  const repeatedApproval = await fetch(`${baseUrl}/api/admin/officer-registrations/${pending.id}/approve`, {
    method: 'POST',
    headers: headers(adminToken),
  })
  assert.equal(repeatedApproval.status, 404)

  const setupToken = new URL(sentMessages[0].setupPath, 'http://localhost').searchParams.get('token')
  const setupTokenRecord = await User.findById(pending.id).select('+setupTokenHash').lean()
  assert.equal(setupTokenRecord.setupTokenHash, createHash('sha256').update(setupToken).digest('hex'))
  assert.notEqual(setupTokenRecord.setupTokenHash, setupToken)
  const password = 'OfficerPermanent123!'
  const invalidToken = await fetch(`${baseUrl}/api/auth/officer-setup`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ setupToken: 'invalid-token', temporaryPassword: password }),
  })
  assert.equal(invalidToken.status, 400)
  await User.updateOne({ _id: pending.id }, { $set: { setupTokenExpiresAt: new Date(Date.now() - 1000) } })
  const expiredSetup = await fetch(`${baseUrl}/api/auth/officer-setup`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ setupToken, temporaryPassword: password }),
  })
  assert.equal(expiredSetup.status, 400)
  await User.updateOne({ _id: pending.id }, { $set: { setupTokenExpiresAt: new Date(Date.now() + 60_000) } })

  const setup = await fetch(`${baseUrl}/api/auth/officer-setup`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ setupToken, temporaryPassword: password }),
  })
  assert.equal(setup.status, 200)
  const setupBody = await setup.json()
  assert.equal(setupBody.user.mustChangePassword, false)
  assert.equal('passwordHash' in setupBody.user, false)
  assert.equal('token' in setupBody, false)
  const stored = await User.findById(pending.id).select('+passwordHash +setupTokenHash').lean()
  assert.equal(await bcrypt.compare(password, stored.passwordHash), true)
  assert.equal(stored.mustChangePassword, false)
  assert.equal(stored.setupTokenHash, undefined)

  const reusedSetup = await fetch(`${baseUrl}/api/auth/officer-setup`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ setupToken, temporaryPassword: password }),
  })
  assert.equal(reusedSetup.status, 400)

  const permanentLogin = await login('REV-895', password)
  assert.equal(permanentLogin.status, 200)
  const permanentSession = await permanentLogin.json()
  assert.equal(permanentSession.user.mustChangePassword, false)
  assert.equal('passwordHash' in permanentSession.user, false)
  testTokenIds.push(JSON.parse(Buffer.from(permanentSession.token.split('.')[1], 'base64url').toString()).jti)
  assert.equal((await fetch(`${baseUrl}/api/officer/applications`, {
    headers: headers(permanentSession.token),
  })).status, 200)
  configureOfficerEmailSender(null)
  await User.updateOne(
    { _id: pending.id },
    { $set: { accountStatus: 'SUSPENDED', isActive: false } },
  )
  assert.equal((await login('REV-895', password)).status, 403)
})

test('Officer status lookup is minimal and setup remains owner-authorized after approval', async () => {
  const firstResponse = await registerOfficerById('REV-894')
  const first = await firstResponse.json()
  const secondResponse = await registerOfficerById('REV-897')
  const second = await secondResponse.json()
  assert.equal(firstResponse.status, 201)
  assert.equal(secondResponse.status, 201)

  const statusUrl = `${baseUrl}/api/officer/registration/status`
  const statusRequest = (governmentOfficerId, token) => fetch(statusUrl, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ governmentOfficerId }),
  })
  const pendingStatusResponse = await statusRequest('REV-894')
  assert.equal(pendingStatusResponse.status, 200)
  const pendingStatus = await pendingStatusResponse.json()
  assert.equal(pendingStatus.governmentOfficerId, 'REV-894')
  assert.equal(pendingStatus.status, 'PENDING')
  assert.equal(pendingStatus.passwordSetupAvailable, false)
  assert.deepEqual(Object.keys(pendingStatus).sort(), ['governmentOfficerId', 'passwordSetupAvailable', 'status'])
  const otherOfficerStatus = await statusRequest('REV-897')
  assert.equal(otherOfficerStatus.status, 200)
  assert.equal((await otherOfficerStatus.json()).status, 'PENDING')
  const notRegisteredStatus = await statusRequest('REV-015')
  assert.equal(notRegisteredStatus.status, 200)
  assert.equal((await notRegisteredStatus.json()).status, 'NOT_REGISTERED')
  assert.equal((await statusRequest('REV-999')).status, 404)

  const pendingSetup = await fetch(`${baseUrl}/api/officer/registration/setup`, {
    method: 'POST',
    headers: headers(first.registrationAccessToken),
    body: JSON.stringify({ governmentOfficerId: 'REV-894', temporaryPassword: 'OfficerPermanent123!' }),
  })
  assert.equal(pendingSetup.status, 403)
  const otherOfficerSetup = await fetch(`${baseUrl}/api/officer/registration/setup`, {
    method: 'POST',
    headers: headers(first.registrationAccessToken),
    body: JSON.stringify({ governmentOfficerId: 'REV-897', temporaryPassword: 'OfficerPermanent123!' }),
  })
  assert.equal(otherOfficerSetup.status, 401)
  const applicantSetup = await fetch(`${baseUrl}/api/officer/registration/setup`, {
    method: 'POST',
    headers: headers(applicantToken),
    body: JSON.stringify({ governmentOfficerId: 'REV-894', temporaryPassword: 'OfficerPermanent123!' }),
  })
  assert.equal(applicantSetup.status, 401)
  const withoutRegistrationCredential = await fetch(`${baseUrl}/api/officer/registration/setup`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ governmentOfficerId: 'REV-894', temporaryPassword: 'OfficerPermanent123!' }),
  })
  assert.equal(withoutRegistrationCredential.status, 401)

  const approval = await fetch(`${baseUrl}/api/admin/officer-registrations/${first.user.id}/approve`, {
    method: 'POST',
    headers: headers(adminToken),
  })
  assert.equal(approval.status, 200)
  const approvalBody = await approval.json()
  assert.equal('developmentSetupPreviewId' in approvalBody, false)
  assert.doesNotMatch(JSON.stringify(approvalBody), /setupPath|token=/i)
  const adminPreview = await fetch(
    `${baseUrl}/api/admin/officer-registrations/${first.user.id}/setup-email-preview/unavailable`,
    { headers: headers(adminToken) },
  )
  assert.equal(adminPreview.status, 404)

  const approvedStatusResponse = await statusRequest('REV-894', first.registrationAccessToken)
  const approvedStatus = await approvedStatusResponse.json()
  assert.equal(approvedStatusResponse.status, 200)
  assert.equal(approvedStatus.status, 'APPROVED')
  assert.equal(approvedStatus.passwordSetupAvailable, true)
  assert.equal(
    approvedStatus.passwordSetupUrl,
    '/officer/setup?registration=1&officerId=REV-894',
  )
  assert.doesNotMatch(approvedStatus.passwordSetupUrl, /token=/i)
  const approvedWithoutCapability = await statusRequest('REV-894')
  const approvedWithoutCapabilityBody = await approvedWithoutCapability.json()
  assert.equal(approvedWithoutCapabilityBody.passwordSetupAvailable, false)
  assert.equal('passwordSetupUrl' in approvedWithoutCapabilityBody, false)

  const password = 'OfficerRegistrationSetup123!'
  const setup = await fetch(`${baseUrl}/api/officer/registration/setup`, {
    method: 'POST',
    headers: headers(first.registrationAccessToken),
    body: JSON.stringify({ governmentOfficerId: 'REV-894', temporaryPassword: password }),
  })
  assert.equal(setup.status, 200)
  const setupBody = await setup.json()
  assert.equal(setupBody.user.mustChangePassword, false)
  assert.equal('passwordHash' in setupBody.user, false)
  assert.equal('registrationAccessToken' in setupBody, false)

  const stored = await User.findById(first.user.id)
    .select('+passwordHash +setupTokenHash +registrationAccessTokenHash').lean()
  assert.equal(await bcrypt.compare(password, stored.passwordHash), true)
  assert.equal(stored.setupTokenHash, undefined)
  assert.equal(stored.registrationAccessTokenHash, undefined)
  const activeStatusResponse = await statusRequest('REV-894', first.registrationAccessToken)
  assert.equal(activeStatusResponse.status, 200)
  const activeStatus = await activeStatusResponse.json()
  assert.equal(activeStatus.status, 'ACTIVE')
  assert.equal(activeStatus.passwordSetupAvailable, false)
  assert.equal((await fetch(`${baseUrl}/api/officer/registration/setup`, {
    method: 'POST',
    headers: headers(first.registrationAccessToken),
    body: JSON.stringify({ governmentOfficerId: 'REV-894', temporaryPassword: password }),
  })).status, 401)
  assert.equal((await login('REV-894', password)).status, 200)

  await User.updateOne(
    { _id: second.user.id },
    { $set: { registrationAccessTokenExpiresAt: new Date(Date.now() - 1000) } },
  )
  assert.equal((await statusRequest('REV-897', second.registrationAccessToken)).status, 200)
})

test('synthetic Officer registry seed is idempotent and never creates User accounts', async () => {
  const codes = ['REVENUE', 'MUNICIPAL', 'TRANSPORT', 'EDUCATION', 'HEALTH', 'AGRICULTURE', 'SOCIAL_WELFARE', 'LAND_RECORDS', 'RURAL_DEVELOPMENT', 'GENERAL_ADMIN']
  const departmentCount = await Department.countDocuments({ code: { $in: codes } })
  if (departmentCount !== 10) return

  const { seedSyntheticOfficerRegistry } = await import('../src/services/officerRegistrySeedService.mjs')
  const prefixByCode = {
    REVENUE: 'REV',
    MUNICIPAL: 'MUN',
    TRANSPORT: 'TRN',
    EDUCATION: 'EDU',
    HEALTH: 'HLT',
    AGRICULTURE: 'AGR',
    SOCIAL_WELFARE: 'SOC',
    LAND_RECORDS: 'LND',
    RURAL_DEVELOPMENT: 'RUR',
    GENERAL_ADMIN: 'GAD',
  }
  const seededOfficerIds = codes.flatMap((code) =>
    Array.from({ length: 15 }, (_value, index) => `${prefixByCode[code]}-${String(index + 1).padStart(3, '0')}`),
  )
  const userCountBeforeSeeding = await User.countDocuments({ governmentOfficerId: { $in: seededOfficerIds } })
  const firstRun = await seedSyntheticOfficerRegistry()
  const secondRun = await seedSyntheticOfficerRegistry()
  assert.equal(firstRun.created + firstRun.alreadyPresent, 150)
  assert.equal(secondRun.created, 0)
  assert.equal(secondRun.alreadyPresent, 150)
  assert.equal(await GovernmentOfficerRegistry.countDocuments({ governmentOfficerId: { $in: seededOfficerIds } }), 150)
  assert.equal(
    await User.countDocuments({ governmentOfficerId: { $in: seededOfficerIds } }),
    userCountBeforeSeeding,
  )
})

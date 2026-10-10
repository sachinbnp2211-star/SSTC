import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { signToken } from '../src/middleware/auth.mjs'
import Department from '../src/models/Department.mjs'
import User from '../src/models/User.mjs'
import { configureOfficerEmailSender } from '../src/services/emailService.mjs'

const runId = `${process.pid}-${Date.now()}`
const testEmails = []
const sentMessages = []
let server
let baseUrl
let admin
let adminToken
let verifier
let registrationAccessToken
let setupToken
const previousNodeEnv = env.NODE_ENV

function headers(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request(path, options = {}, token) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers(token), ...options.headers },
  })
}

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured for Human Verifier registration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true)
  env.NODE_ENV = 'development'

  const adminPasswordHash = await bcrypt.hash('HumanVerifierTestAdminPassword!', 10)
  admin = await User.create({
    email: `human-verifier-admin-${runId}@example.test`,
    displayName: 'Human Verifier Test Admin',
    passwordHash: adminPasswordHash,
    role: 'ADMIN',
    permissions: ['ORG_OVERVIEW', 'USER_MANAGE', 'DEPARTMENT_MANAGE'],
    isActive: true,
    accountStatus: 'ACTIVE',
  })
  testEmails.push(admin.email)
  adminToken = signToken({
    id: String(admin._id),
    role: admin.role,
    permissions: admin.permissions,
  })
  configureOfficerEmailSender(async (message) => {
    sentMessages.push(message)
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
  configureOfficerEmailSender(null)
  env.NODE_ENV = previousNodeEnv
  if (testEmails.length) {
    await User.deleteMany({ email: { $in: testEmails } })
    await mongoose.connection.collection('auditevents').deleteMany({
      actorId: admin?._id,
      action: { $in: ['HUMAN_VERIFIER_REGISTRATION_APPROVED', 'HUMAN_VERIFIER_REGISTRATION_SUBMITTED'] },
    })
  }
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

test('Human Verifier self-registers without OTP or department, awaits Admin approval, sets up password, and logs in', async () => {
  const email = `human-verifier-${runId}@example.test`
  testEmails.push(email)

  const registrationResponse = await request('/api/auth/officer-registration', {
    method: 'POST',
    body: JSON.stringify({
      role: 'HUMAN_VERIFIER',
      email,
      displayName: 'Human Verifier Officer',
      departmentId: 'not-accepted',
      registrationCredential: 'not-accepted',
    }),
  })
  assert.equal(registrationResponse.status, 201)
  const registration = await registrationResponse.json()
  verifier = registration.user
  registrationAccessToken = registration.registrationAccessToken
  assert.equal(registration.status, 'PENDING')
  assert.equal(verifier.role, 'HUMAN_VERIFIER')
  assert.equal(verifier.accountStatus, 'PENDING')
  assert.equal(verifier.departmentId, null)
  assert.equal(verifier.governmentOfficerId, null)
  assert.equal(verifier.isActive, false)
  assert.equal('passwordHash' in verifier, false)
  assert.equal('registrationAccessTokenHash' in verifier, false)
  assert.equal((await User.findById(verifier.id).lean()).departmentId, null)

  const duplicateResponse = await request('/api/auth/officer-registration', {
    method: 'POST',
    body: JSON.stringify({
      role: 'HUMAN_VERIFIER',
      email,
      displayName: 'Duplicate Verifier',
    }),
  })
  assert.equal(duplicateResponse.status, 409)

  const pendingLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: email, password: 'UnapprovedPassword123!' }),
  })
  assert.equal(pendingLogin.status, 403)

  const adminQueueResponse = await request(
    '/api/admin/officer-registrations?status=PENDING',
    {},
    adminToken,
  )
  assert.equal(adminQueueResponse.status, 200)
  const adminQueue = await adminQueueResponse.json()
  const pendingRegistration = adminQueue.registrations.find((item) => item.id === verifier.id)
  assert.equal(pendingRegistration.role, 'HUMAN_VERIFIER')
  assert.equal(pendingRegistration.displayName, 'Human Verifier Officer')
  assert.equal(pendingRegistration.email, email)
  assert.equal(pendingRegistration.departmentId, null)

  const wrongRoleResponse = await request('/api/auth/officer-registration', {
    method: 'POST',
    body: JSON.stringify({ role: 'ADMIN', email, displayName: 'Role Escalation' }),
  })
  assert.equal(wrongRoleResponse.status, 400)

  const approvalResponse = await request(
    `/api/admin/officer-registrations/${verifier.id}/approve`,
    { method: 'POST' },
    adminToken,
  )
  assert.equal(approvalResponse.status, 200)
  const approval = await approvalResponse.json()
  assert.equal(approval.user.role, 'HUMAN_VERIFIER')
  assert.equal('passwordSetupUrl' in approval, false)
  assert.equal('setupToken' in approval, false)

  const statusResponse = await request('/api/officer/registration/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${registrationAccessToken}` },
    body: JSON.stringify({ role: 'HUMAN_VERIFIER', email }),
  })
  assert.equal(statusResponse.status, 200)
  const status = await statusResponse.json()
  assert.equal(status.status, 'APPROVED')
  assert.equal(status.passwordSetupAvailable, true)
  assert.equal(status.passwordSetupUrl, `/human-verifier/setup?registration=1&email=${encodeURIComponent(email)}`)

  const setupMessage = sentMessages.find((message) => message.metadata?.type === 'HUMAN_VERIFIER_PASSWORD_SETUP')
  assert.ok(setupMessage)
  const parsedSetupUrl = new URL(setupMessage.setupPath, 'http://localhost')
  setupToken = parsedSetupUrl.searchParams.get('token')
  assert.ok(setupToken)
  const newPassword = 'HumanVerifierPermanentPassword!'
  const setupResponse = await request('/api/auth/officer-setup', {
    method: 'POST',
    body: JSON.stringify({ role: 'HUMAN_VERIFIER', setupToken, temporaryPassword: newPassword }),
  })
  assert.equal(setupResponse.status, 200)
  const setupBody = await setupResponse.json()
  assert.equal(setupBody.user.role, 'HUMAN_VERIFIER')
  assert.equal('passwordHash' in setupBody.user, false)
  assert.equal('setupTokenHash' in setupBody.user, false)
  assert.equal('setupToken' in setupBody, false)
  const storedVerifier = await User.findById(verifier.id).select('+passwordHash +setupTokenHash').lean()
  assert.equal(await bcrypt.compare(newPassword, storedVerifier.passwordHash), true)
  assert.equal(storedVerifier.setupTokenHash, undefined)
  assert.equal(storedVerifier.mustChangePassword, false)

  const reusedSetupResponse = await request('/api/auth/officer-setup', {
    method: 'POST',
    body: JSON.stringify({ role: 'HUMAN_VERIFIER', setupToken, temporaryPassword: newPassword }),
  })
  assert.equal(reusedSetupResponse.status, 400)

  const loginResponse = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: email, password: newPassword }),
  })
  assert.equal(loginResponse.status, 200)
  const loginBody = await loginResponse.json()
  assert.equal(loginBody.user.role, 'HUMAN_VERIFIER')
  assert.equal('passwordHash' in loginBody.user, false)

  assert.equal((await request('/api/human-verification', {}, loginBody.token)).status, 200)
  assert.equal((await request('/api/admin/overview', {}, loginBody.token)).status, 403)
  assert.equal((await request('/api/officer/applications', {}, loginBody.token)).status, 403)
})

test('Human Verifier approval requires the existing delivery boundary and setup only accepts secure credentials', async () => {
  const email = `human-verifier-negative-${runId}@example.test`
  testEmails.push(email)
  const registration = await request('/api/auth/officer-registration', {
    method: 'POST',
    body: JSON.stringify({ role: 'HUMAN_VERIFIER', email, displayName: 'Verifier Negative Test' }),
  })
  assert.equal(registration.status, 201)
  const { user } = await registration.json()
  verifier = user

  const statusWithoutRegistrationCredential = await request('/api/officer/registration/status', {
    method: 'POST',
    body: JSON.stringify({ role: 'HUMAN_VERIFIER', email }),
  })
  assert.equal(statusWithoutRegistrationCredential.status, 200)
  assert.equal((await statusWithoutRegistrationCredential.json()).passwordSetupAvailable, false)

  assert.equal((await request('/api/auth/officer-setup', {
    method: 'POST',
    body: JSON.stringify({ role: 'HUMAN_VERIFIER', setupToken: 'invalid', temporaryPassword: 'HumanVerifierPermanentPassword!' }),
  })).status, 400)

  const previousSenderMessages = sentMessages.length
  await request(`/api/admin/officer-registrations/${user.id}/approve`, { method: 'POST' }, adminToken)
  assert.ok(sentMessages.length > previousSenderMessages)
  assert.equal(sentMessages.at(-1).metadata.type, 'HUMAN_VERIFIER_PASSWORD_SETUP')
})

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { requireAuth, requirePermission, requireRole, signToken } from '../src/middleware/auth.mjs'
import Application from '../src/models/Application.mjs'
import RevokedToken from '../src/models/RevokedToken.mjs'
import User from '../src/models/User.mjs'
import { configureOfficerEmailSender } from '../src/services/emailService.mjs'

const runId = `${process.pid}-${Date.now()}`
const testEmails = []
const testTokenIds = []
const testApplicationIds = []
let server
let baseUrl

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run authentication integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for authentication integration tests.')
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
  if (testApplicationIds.length > 0) {
    await Application.deleteMany({ _id: { $in: testApplicationIds } })
  }
  if (testEmails.length > 0) {
    await User.deleteMany({ email: { $in: testEmails } })
  }
  if (testTokenIds.length > 0) {
    await RevokedToken.deleteMany({ tokenId: { $in: testTokenIds } })
  }
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

async function register(email, extra = {}) {
  testEmails.push(email)
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPassword123!',
      displayName: 'Test Applicant',
      ...extra,
    }),
  })
}

test('registration persists an applicant with a bcrypt hash and never returns it', async () => {
  const email = `applicant-${runId}@example.test`
  const response = await register(email, { role: 'ADMIN' })
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.user.email, email)
  assert.equal(body.user.role, 'APPLICANT')
  assert.equal('passwordHash' in body.user, false)
  assert.equal(typeof body.token, 'string')

  const storedUser = await User.findOne({ email }).lean()
  assert.ok(storedUser)
  assert.notEqual(storedUser.passwordHash, 'TestPassword123!')
  assert.equal(await bcrypt.compare('TestPassword123!', storedUser.passwordHash), true)
})

test('registration rejects duplicate email addresses', async () => {
  const email = `duplicate-${runId}@example.test`
  const firstResponse = await register(email)
  const duplicateResponse = await register(email)

  assert.equal(firstResponse.status, 201)
  assert.equal(duplicateResponse.status, 409)
  assert.deepEqual(await duplicateResponse.json(), {
    error: 'An account with that email already exists.',
  })
})

test('login issues a JWT for a provisioned account and /me returns the database user safely', async () => {
  const email = `login-${runId}@example.test`
  const registrationResponse = await register(email)
  const registration = await registrationResponse.json()
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword123!' }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.user.id, registration.user.id)
  assert.equal('passwordHash' in body.user, false)
  assert.equal(typeof body.token, 'string')

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${body.token}` },
  })
  const me = await meResponse.json()
  assert.equal(meResponse.status, 200)
  assert.equal(me.user.id, registration.user.id)
  assert.equal(me.user.role, 'APPLICANT')
  assert.equal('passwordHash' in me.user, false)
})

test('public status lookup returns only tracking details by email or Application ID without authenticating', async () => {
  const email = `status-access-${runId}@example.test`
  const registrationResponse = await register(email)
  const registration = await registrationResponse.json()
  const application = await Application.create({
    applicantId: registration.user.id,
    applicationType: 'Residence Certificate',
    applicationData: {
      title: 'Status access test',
      applicantName: 'Test Applicant',
      contactEmail: email,
      details: 'Application ID login test.',
    },
    status: 'PROCESSING',
    submittedAt: new Date(),
  })
  testApplicationIds.push(application._id)

  const byEmail = await fetch(`${baseUrl}/api/application-status/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email }),
  })
  const emailBody = await byEmail.json()
  assert.equal(byEmail.status, 200)
  assert.equal(emailBody.applications.length, 1)
  assert.equal(emailBody.applications[0].id, String(application._id))
  assert.equal(emailBody.applications[0].status, 'PROCESSING')
  assert.equal('token' in emailBody, false)
  assert.equal('user' in emailBody, false)
  assert.equal('applicantName' in emailBody.applications[0], false)
  assert.equal('contactEmail' in emailBody.applications[0], false)
  assert.equal('details' in emailBody.applications[0], false)

  const byApplicationId = await fetch(`${baseUrl}/api/application-status/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: String(application._id),
    }),
  })
  const applicationBody = await byApplicationId.json()
  assert.equal(byApplicationId.status, 200)
  assert.equal(applicationBody.applications[0].id, String(application._id))
  assert.equal('token' in applicationBody, false)

  const otherEmail = `status-other-${runId}@example.test`
  await register(otherEmail)
  const noMatch = await fetch(`${baseUrl}/api/application-status/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: otherEmail }),
  })
  assert.equal(noMatch.status, 200)
  assert.deepEqual((await noMatch.json()).applications, [])

  const invalidInput = await fetch(`${baseUrl}/api/application-status/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'not-an-email-or-id' }),
  })
  assert.equal(invalidInput.status, 400)
})

test('password reset delivers a short-lived one-time link and changes the applicant password', async () => {
  const email = `password-reset-${runId}@example.test`
  await register(email)
  const sentMessages = []
  configureOfficerEmailSender(async (message) => {
    sentMessages.push(message)
  })
  try {
    const requestResponse = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email }),
    })
    const requestBody = await requestResponse.json()
    assert.equal(requestResponse.status, 200)
    assert.match(requestBody.message, /If an eligible account matches/)
    assert.equal(sentMessages.length, 1)
    assert.equal(sentMessages[0].to, email)
    assert.equal(sentMessages[0].metadata.type, 'PASSWORD_RESET')

    const user = await User.findOne({ email })
      .select('+passwordResetTokenHash +passwordResetTokenExpiresAt')
      .lean()
    assert.ok(user.passwordResetTokenHash)
    assert.ok(user.passwordResetTokenExpiresAt instanceof Date)
    assert.equal(sentMessages[0].resetPath.includes(user.passwordResetTokenHash), false)
    const resetToken = new URL(sentMessages[0].resetPath, 'http://localhost').searchParams.get('token')
    assert.ok(resetToken)

    const completeResponse = await fetch(`${baseUrl}/api/auth/password-reset/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        newPassword: 'ResetPassword456!',
      }),
    })
    assert.equal(completeResponse.status, 200)
    assert.match((await completeResponse.json()).message, /password has been reset/i)
    assert.equal(await User.findOne({ email }).select('+passwordResetTokenHash').then((record) => record.passwordResetTokenHash), null)

    const oldPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'TestPassword123!' }),
    })
    assert.equal(oldPasswordLogin.status, 401)
    const newPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'ResetPassword456!' }),
    })
    assert.equal(newPasswordLogin.status, 200)

    const unknownAccount = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `missing-${runId}@example.test` }),
    })
    assert.equal(unknownAccount.status, 200)
    assert.equal((await unknownAccount.json()).message, requestBody.message)
    assert.equal(sentMessages.length, 1)

    const reusedToken = await fetch(`${baseUrl}/api/auth/password-reset/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        newPassword: 'ResetPassword789!',
      }),
    })
    assert.equal(reusedToken.status, 400)
  } finally {
    configureOfficerEmailSender(null)
  }
})

test('invalid credentials and unauthenticated or invalid tokens are rejected', async () => {
  const email = `invalid-${runId}@example.test`
  await register(email)
  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'WrongPassword123!' }),
  })
  assert.equal(badLogin.status, 401)

  const missingToken = await fetch(`${baseUrl}/api/auth/me`)
  assert.equal(missingToken.status, 401)
  const invalidToken = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: 'Bearer invalid-token' },
  })
  assert.equal(invalidToken.status, 401)
})

test('logout revokes the current JWT so it cannot be reused', async () => {
  const email = `logout-${runId}@example.test`
  const registrationResponse = await register(email)
  const registration = await registrationResponse.json()
  const payload = JSON.parse(Buffer.from(registration.token.split('.')[1], 'base64url').toString())
  testTokenIds.push(payload.jti)

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${registration.token}` },
  })
  assert.equal(logoutResponse.status, 200)
  assert.deepEqual(await logoutResponse.json(), { ok: true })

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${registration.token}` },
  })
  assert.equal(meResponse.status, 401)
})

test('authentication middleware loads current role and permissions from MongoDB', async () => {
  const email = `verifier-${runId}@example.test`
  testEmails.push(email)
  const passwordHash = await bcrypt.hash('TestPassword123!', 10)
  const verifier = await User.create({
    email,
    displayName: 'Provisioned Verifier',
    passwordHash,
    role: 'HUMAN_VERIFIER',
    permissions: ['HUMAN_VERIFY_OCR'],
  })
  const tokenWithStaleRole = signToken({
    id: String(verifier._id),
    role: 'APPLICANT',
    permissions: [],
  })

  const response = await fetch(`${baseUrl}/api/human-verification`, {
    headers: { Authorization: `Bearer ${tokenWithStaleRole}` },
  })
  assert.equal(response.status, 200)

  const applicantEmail = `ordinary-${runId}@example.test`
  const registration = await register(applicantEmail)
  const applicant = await registration.json()
  const denied = await fetch(`${baseUrl}/api/human-verification`, {
    headers: { Authorization: `Bearer ${applicant.token}` },
  })
  assert.equal(denied.status, 403)

  const unauthenticated = await fetch(`${baseUrl}/api/human-verification`)
  assert.equal(unauthenticated.status, 401)
})

test('role and permission middleware reject actors without the required access', () => {
  const response = {
    status(code) {
      this.code = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
  }
  const request = { user: { role: 'APPLICANT', permissions: [] } }

  requireRole('OFFICER')(request, response, () => assert.fail('Role guard unexpectedly allowed access.'))
  assert.equal(response.code, 403)

  requirePermission('HUMAN_VERIFY_OCR')(request, response, () => assert.fail('Permission guard unexpectedly allowed access.'))
  assert.equal(response.code, 403)
})

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

import app from '../src/app.mjs'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { signToken } from '../src/middleware/auth.mjs'
import AuditEvent from '../src/models/AuditEvent.mjs'
import Application from '../src/models/Application.mjs'
import Department from '../src/models/Department.mjs'
import GovernmentOfficerRegistry from '../src/models/GovernmentOfficerRegistry.mjs'
import User from '../src/models/User.mjs'

const runId = `${process.pid}-${Date.now()}`
const createdEmails = []
const createdDepartmentCodes = []
const createdGovernmentOfficerIds = []
let server
let baseUrl
let adminUser
let adminToken
let department

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run admin integration tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for admin integration tests.')

  server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`

  const adminEmail = `admin-${runId}@example.test`
  createdEmails.push(adminEmail)
  adminUser = await User.create({
    email: adminEmail,
    displayName: 'System Admin',
    passwordHash: await bcrypt.hash('AdminPassword123!', 10),
    role: 'ADMIN',
    permissions: ['ORG_OVERVIEW', 'APPLICATION_VIEW_ALL', 'USER_MANAGE', 'DEPARTMENT_MANAGE'],
    isActive: true,
  })
  adminToken = signToken({
    id: String(adminUser._id),
    role: 'ADMIN',
    permissions: adminUser.permissions,
  })

  const departmentCode = `ADM${runId.replace(/[^0-9]/g, '').slice(-4)}`
  createdDepartmentCodes.push(departmentCode)
  department = await Department.create({
    name: 'Admin Department',
    code: departmentCode,
    isActive: true,
  })
})

after(async () => {
  if (createdEmails.length > 0) {
    await User.deleteMany({ email: { $in: createdEmails } })
  }
  if (createdGovernmentOfficerIds.length > 0) {
    await GovernmentOfficerRegistry.deleteMany({
      governmentOfficerId: { $in: createdGovernmentOfficerIds },
    })
  }
  if (createdDepartmentCodes.length > 0) {
    await Application.deleteMany({ departmentId: { $in: await Department.find({ code: { $in: createdDepartmentCodes } }).distinct('_id') } })
    await Department.deleteMany({ code: { $in: createdDepartmentCodes } })
  }
  await mongoose.connection.collection('auditevents').deleteMany({
    actorId: adminUser._id,
    action: { $in: ['USER_CREATED', 'USER_UPDATED', 'USER_ROLE_UPDATED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'DEPARTMENT_CREATED', 'DEPARTMENT_UPDATED', 'DEPARTMENT_ACTIVATED', 'DEPARTMENT_DEACTIVATED', 'OFFICER_ASSIGNMENT_RETRIED', 'OFFICER_PASSWORD_SETUP_REISSUED'] },
  })
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  await mongoose.disconnect()
})

async function createApplicantUser(email) {
  createdEmails.push(email)
  const passwordHash = await bcrypt.hash('ApplicantPassword123!', 10)
  return User.create({
    email,
    displayName: 'Applicant User',
    passwordHash,
    role: 'APPLICANT',
    permissions: ['APPLICATION_CREATE'],
    isActive: true,
  })
}

function adminHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
    ...extra,
  }
}

function tokenHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

test('admin routes require authenticated ADMIN access', async () => {
  const applicant = await createApplicantUser(`applicant-${runId}@example.test`)
  const officerEmail = `officer-access-${runId}@example.test`
  createdEmails.push(officerEmail)
  const officer = await User.create({
    email: officerEmail,
    displayName: 'Officer User',
    passwordHash: await bcrypt.hash('OfficerPassword123!', 10),
    role: 'OFFICER',
    permissions: ['APPLICATION_VIEW_ASSIGNED'],
    isActive: true,
  })
  const applicantToken = signToken({
    id: String(applicant._id),
    role: 'APPLICANT',
    permissions: applicant.permissions,
  })
  const officerToken = signToken({
    id: String(officer._id),
    role: 'GENERAL_OFFICER',
    permissions: officer.permissions,
  })

  const unauthenticated = await fetch(`${baseUrl}/api/admin/overview`)
  assert.equal(unauthenticated.status, 401)

  const applicantDenied = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${applicantToken}` },
  })
  assert.equal(applicantDenied.status, 403)
  const applicantDepartmentsDenied = await fetch(`${baseUrl}/api/admin/departments`, {
    headers: { Authorization: `Bearer ${applicantToken}` },
  })
  assert.equal(applicantDepartmentsDenied.status, 403)
  const officerDenied = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${officerToken}` },
  })
  assert.equal(officerDenied.status, 403)
  const officerDepartmentsDenied = await fetch(`${baseUrl}/api/admin/departments`, {
    headers: { Authorization: `Bearer ${officerToken}` },
  })
  assert.equal(officerDepartmentsDenied.status, 403)
})

test('Admin can retry assignment for a waiting application using its resolved department', async () => {
  const applicant = await createApplicantUser(`retry-applicant-${runId}@example.test`)
  const retryDepartmentCode = `RETRY${runId.replace(/[^0-9]/g, '').slice(-4)}`
  createdDepartmentCodes.push(retryDepartmentCode)
  const retryDepartment = await Department.create({
    name: `Retry Assignment Department ${runId}`,
    code: retryDepartmentCode,
    isActive: true,
  })
  const officerEmail = `retry-officer-${runId}@example.test`
  createdEmails.push(officerEmail)
  const officer = await User.create({
    email: officerEmail,
    displayName: 'Retry Assignment Officer',
    passwordHash: await bcrypt.hash('OfficerPassword123!', 10),
    role: 'OFFICER',
    departmentId: String(retryDepartment._id),
    permissions: ['APPLICATION_VIEW_ASSIGNED'],
    accountStatus: 'ACTIVE',
    isActive: true,
    mustChangePassword: false,
  })
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Waiting assignment retry',
    applicationData: {
      title: 'Waiting for an eligible Officer',
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'The previously resolved Department must be preserved.',
    },
    status: 'WAITING_FOR_OFFICER_ASSIGNMENT',
    departmentId: retryDepartment._id,
    assignedOfficerId: null,
    assignedAt: null,
  })

  const response = await fetch(
    `${baseUrl}/api/admin/applications/${application._id}/retry-assignment`,
    { method: 'POST', headers: adminHeaders() },
  )
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.status, 'ASSIGNED')
  assert.equal(body.department.id, String(retryDepartment._id))
  assert.equal(body.assignedOfficerId, String(officer._id))
  const stored = await Application.findById(application._id).lean()
  assert.equal(String(stored.departmentId), String(retryDepartment._id))
  assert.equal(String(stored.assignedOfficerId), String(officer._id))
  assert.ok(stored.assignedAt instanceof Date)
})

test('Admin can reissue setup for an approved Officer and Officer completes normal password setup', async () => {
  const officerEmail = `reissue-officer-${runId}@example.test`
  const governmentOfficerId = `ADM-${runId.replace(/[^0-9]/g, '').slice(-3).padStart(3, '0')}`
  createdEmails.push(officerEmail)
  createdGovernmentOfficerIds.push(governmentOfficerId)
  await GovernmentOfficerRegistry.create({
    governmentOfficerId,
    displayName: 'Setup Recovery Officer',
    departmentId: String(department._id),
    officialEmail: officerEmail,
    isActive: true,
  })
  const officer = await User.create({
    email: officerEmail,
    displayName: 'Setup Recovery Officer',
    role: 'OFFICER',
    departmentId: String(department._id),
    governmentOfficerId,
    permissions: ['APPLICATION_VIEW_ASSIGNED'],
    accountStatus: 'ACTIVE',
    isActive: true,
    mustChangePassword: true,
  })

  const reissueResponse = await fetch(
    `${baseUrl}/api/admin/officer-registrations/${officer._id}/reissue-setup`,
    { method: 'POST', headers: adminHeaders() },
  )
  const reissued = await reissueResponse.json()
  assert.equal(reissueResponse.status, 200)
  assert.equal(typeof reissued.setupPath, 'string')
  const setupToken = new URL(reissued.setupPath, baseUrl).searchParams.get('token')
  assert.ok(setupToken)
  const storedPending = await User.findById(officer._id)
    .select('+setupTokenHash +setupTokenExpiresAt')
    .lean()
  assert.ok(storedPending.setupTokenHash)
  assert.ok(storedPending.setupTokenExpiresAt > new Date())

  const setupResponse = await fetch(`${baseUrl}/api/auth/officer-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'OFFICER',
      setupToken,
      temporaryPassword: 'OfficerSetupTestPassword!2026',
    }),
  })
  const setupBody = await setupResponse.json()
  assert.equal(setupResponse.status, 200)
  assert.equal(setupBody.user.role, 'OFFICER')
  assert.equal(setupBody.user.accountStatus, 'ACTIVE')
  assert.equal(setupBody.user.isActive, true)
  assert.equal(setupBody.user.mustChangePassword, false)
  assert.equal(setupBody.user.departmentId, String(department._id))
  assert.equal('setupTokenHash' in setupBody.user, false)
})

test('Admin can log in with a bcrypt-protected password and use the Admin API', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: adminUser.email,
      password: 'AdminPassword123!',
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.user.role, 'ADMIN')
  assert.equal('passwordHash' in body.user, false)
  assert.equal(typeof body.token, 'string')
  const overview = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${body.token}` },
  })
  assert.equal(overview.status, 200)
})

test('user management requires USER_MANAGE while overview uses ORG_OVERVIEW', async () => {
  const email = `overview-only-${runId}@example.test`
  createdEmails.push(email)
  const overviewOnlyAdmin = await User.create({
    email,
    displayName: 'Overview Only Admin',
    passwordHash: await bcrypt.hash('AdminPassword123!', 10),
    role: 'ADMIN',
    permissions: ['ORG_OVERVIEW'],
    isActive: true,
  })
  const token = signToken({
    id: String(overviewOnlyAdmin._id),
    role: 'ADMIN',
    permissions: overviewOnlyAdmin.permissions,
  })
  const headers = tokenHeaders(token)

  const overviewResponse = await fetch(`${baseUrl}/api/admin/overview`, { headers })
  assert.equal(overviewResponse.status, 200)
  const usersResponse = await fetch(`${baseUrl}/api/admin/users`, { headers })
  assert.equal(usersResponse.status, 403)
  await User.updateOne(
    { _id: overviewOnlyAdmin._id },
    { $set: { permissions: ['USER_MANAGE'] } },
  )
  const userManagerHeaders = tokenHeaders(token)
  const allowedUsersResponse = await fetch(`${baseUrl}/api/admin/users`, {
    headers: userManagerHeaders,
  })
  assert.equal(allowedUsersResponse.status, 200)
  const deniedOverviewResponse = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: userManagerHeaders,
  })
  assert.equal(deniedOverviewResponse.status, 403)
  await User.deleteOne({ _id: overviewOnlyAdmin._id })
})

test('admin can create and list departments', async () => {
  const deptCode = `DPT${runId.replace(/[^0-9]/g, '').slice(-4)}Z`
  createdDepartmentCodes.push(deptCode, `${deptCode}-UPDATED`)

  const createResponse = await fetch(`${baseUrl}/api/admin/departments`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      name: 'Department of Records',
      code: deptCode.toLowerCase(),
      description: 'Records and archive administration.',
      isActive: false,
    }),
  })
  assert.equal(createResponse.status, 201)
  const createdDepartment = await createResponse.json()
  assert.equal(createdDepartment.department.name, 'Department of Records')
  assert.equal(createdDepartment.department.code, deptCode)
  assert.equal(createdDepartment.department.description, 'Records and archive administration.')
  assert.equal(createdDepartment.department.isActive, false)
  assert.ok(createdDepartment.department.id)
  assert.equal('_id' in createdDepartment.department, false)

  const listResponse = await fetch(`${baseUrl}/api/admin/departments`, {
    headers: adminHeaders(),
  })
  assert.equal(listResponse.status, 200)
  const listBody = await listResponse.json()
  assert.ok(listBody.departments.some((entry) => entry.code === deptCode))
  assert.equal(
    listBody.departments.find((entry) => entry.code === deptCode).isCodeEditable,
    true,
  )

  const duplicateResponse = await fetch(`${baseUrl}/api/admin/departments`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'Duplicate Department', code: deptCode.toLowerCase() }),
  })
  assert.equal(duplicateResponse.status, 409)

  const duplicateNameResponse = await fetch(`${baseUrl}/api/admin/departments`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'department of RECORDS', code: `${deptCode}-NAME` }),
  })
  assert.equal(duplicateNameResponse.status, 409)

  const updateResponse = await fetch(`${baseUrl}/api/admin/departments/${createdDepartment.department.id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({
      name: 'Records and Archives',
      code: ` ${deptCode.toLowerCase()}-updated `,
      description: 'Updated records description.',
    }),
  })
  assert.equal(updateResponse.status, 200)
  const updated = await updateResponse.json()
  assert.equal(updated.department.name, 'Records and Archives')
  assert.equal(updated.department.code, `${deptCode}-UPDATED`)
  assert.equal(updated.department.description, 'Updated records description.')

  const duplicateUpdateResponse = await fetch(`${baseUrl}/api/admin/departments/${createdDepartment.department.id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ code: department.code.toLowerCase() }),
  })
  assert.equal(duplicateUpdateResponse.status, 409)

  const invalidCodeResponse = await fetch(`${baseUrl}/api/admin/departments/${createdDepartment.department.id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ code: 'not a valid code' }),
  })
  assert.equal(invalidCodeResponse.status, 400)

  const invalidIdResponse = await fetch(`${baseUrl}/api/admin/departments/not-a-department-id`, {
    headers: adminHeaders(),
  })
  assert.equal(invalidIdResponse.status, 404)

  const audit = await AuditEvent.findOne({
    action: 'DEPARTMENT_UPDATED',
    actorId: adminUser._id,
    reason: /Records and Archives/,
  }).lean()
  assert.ok(audit)
})

test('department listing reports officer and pending application counts', async () => {
  const applicant = await createApplicantUser(`department-count-applicant-${runId}@example.test`)
  const countDepartmentCode = `CNT${runId.replace(/[^0-9]/g, '').slice(-8)}`
  createdDepartmentCodes.push(countDepartmentCode)
  const countDepartment = await Department.create({
    name: `Department Count ${runId}`,
    code: countDepartmentCode,
    isActive: true,
  })
  const officerEmail = `department-count-officer-${runId}@example.test`
  createdEmails.push(officerEmail)
  await User.create({
    email: officerEmail,
    displayName: 'Department Count Officer',
    passwordHash: await bcrypt.hash('OfficerPassword123!', 10),
    role: 'OFFICER',
    departmentId: String(countDepartment._id),
    governmentOfficerId: `COUNT-${runId}`,
    isActive: true,
  })
  await Application.create(['ASSIGNED', 'UNDER_REVIEW'].map((status) => ({
    applicantId: applicant._id,
    applicationType: 'Department workload check',
    applicationData: {
      title: `Workload ${status}`,
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Verify department workload totals.',
    },
    departmentId: countDepartment._id,
    status,
  })))

  const response = await fetch(`${baseUrl}/api/admin/departments`, { headers: adminHeaders() })
  assert.equal(response.status, 200)
  const body = await response.json()
  const listedDepartment = body.departments.find((entry) => entry.id === String(countDepartment._id))
  assert.equal(listedDepartment.officerCount, 1)
  assert.equal(listedDepartment.pendingApplicationCount, 2)
  assert.equal(listedDepartment.isCodeEditable, false)
  assert.equal(listedDepartment.description, '')
  assert.ok(listedDepartment.createdAt)
})

test('department management requires DEPARTMENT_MANAGE', async () => {
  const noDepartmentPermission = await User.create({
    email: `department-permission-${runId}@example.test`,
    displayName: 'User Manager Only',
    passwordHash: await bcrypt.hash('AdminPassword123!', 10),
    role: 'ADMIN',
    permissions: ['USER_MANAGE'],
    isActive: true,
  })
  createdEmails.push(noDepartmentPermission.email)
  const token = signToken({
    id: String(noDepartmentPermission._id),
    role: 'ADMIN',
    permissions: noDepartmentPermission.permissions,
  })

  for (const [url, options] of [
    [`${baseUrl}/api/admin/departments`, { headers: tokenHeaders(token) }],
    [`${baseUrl}/api/admin/departments`, {
      method: 'POST',
      headers: tokenHeaders(token),
      body: JSON.stringify({ name: 'Unauthorized department', code: `NO${runId}` }),
    }],
    [`${baseUrl}/api/admin/departments/${department._id}/deactivate`, {
      method: 'POST',
      headers: tokenHeaders(token),
    }],
  ]) {
    const response = await fetch(url, options)
    assert.equal(response.status, 403)
  }
  await User.updateOne({ _id: noDepartmentPermission._id }, { $set: { isActive: false } })
})

test('General Officer accounts cannot bypass registration approval through Admin provisioning', async () => {
  const email = `officer-${runId}@example.test`
  createdEmails.push(email)

  const response = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      email,
      password: 'OfficerPassword123!',
      displayName: 'Test Officer',
      role: 'GENERAL_OFFICER',
      departmentId: String(department._id),
      governmentOfficerId: 'GOV-1001',
    }),
  })

  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /must register with a Government Officer ID and receive Admin approval/i)
  assert.equal(await User.exists({ email }), null)
})

test('staff creation rejects non-staff roles and invalid departments', async () => {
  const invalidRoleResponse = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      email: `admin-role-${runId}@example.test`,
      password: 'OfficerPassword123!',
      displayName: 'Invalid Admin',
      role: 'ADMIN',
      departmentId: String(department._id),
      governmentOfficerId: 'GOV-INVALID',
    }),
  })
  assert.equal(invalidRoleResponse.status, 400)

  const invalidDepartmentResponse = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      email: `invalid-department-${runId}@example.test`,
      password: 'OfficerPassword123!',
      displayName: 'Invalid Department User',
      role: 'OFFICER',
      departmentId: String(new mongoose.Types.ObjectId()),
      governmentOfficerId: 'GOV-INVALID',
    }),
  })
  assert.equal(invalidDepartmentResponse.status, 400)
})

test('admin can update staff role, department, and officer ID with an audit record', async () => {
  const email = `staff-update-${runId}@example.test`
  createdEmails.push(email)
  const staffUser = await User.create({
    email,
    displayName: 'Staff Update User',
    passwordHash: await bcrypt.hash('VerifierPassword123!', 10),
    role: 'GENERAL_OFFICER',
    departmentId: String(department._id),
    governmentOfficerId: 'GOV-2001',
    permissions: ['APPLICATION_VIEW_ASSIGNED', 'HUMAN_VERIFY_OCR'],
    isActive: true,
  })

  const nextDepartmentCode = `UPD${runId.replace(/[^0-9]/g, '').slice(-4)}`
  createdDepartmentCodes.push(nextDepartmentCode)
  const nextDepartment = await Department.create({
    name: 'Updated Staff Department',
    code: nextDepartmentCode,
    isActive: true,
  })

  const updateResponse = await fetch(`${baseUrl}/api/admin/users/${staffUser._id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({
      departmentId: String(nextDepartment._id),
      governmentOfficerId: 'GOV-2002',
    }),
  })
  assert.equal(updateResponse.status, 200)
  const updatedBody = await updateResponse.json()
  assert.equal(updatedBody.user.role, 'GENERAL_OFFICER')
  assert.equal(updatedBody.user.departmentId, String(nextDepartment._id))
  assert.equal(updatedBody.user.governmentOfficerId, 'GOV-2002')
  assert.deepEqual(updatedBody.user.permissions, ['APPLICATION_VIEW_ASSIGNED', 'HUMAN_VERIFY_OCR'])
  assert.equal('passwordHash' in updatedBody.user, false)

  const audit = await AuditEvent.findOne({
    action: 'USER_UPDATED',
    actorId: adminUser._id,
  }).sort({ occurredAt: -1 }).lean()
  assert.ok(audit)
  assert.equal(audit.actorRole, 'ADMIN')
  assert.match(audit.reason, /department assignment/)
  assert.match(audit.reason, /government officer ID/)

  const invalidRoleResponse = await fetch(`${baseUrl}/api/admin/users/${staffUser._id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ role: 'ADMIN' }),
  })
  assert.equal(invalidRoleResponse.status, 400)

  const invalidDepartmentResponse = await fetch(`${baseUrl}/api/admin/users/${staffUser._id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ departmentId: 'not-a-mongodb-id' }),
  })
  assert.equal(invalidDepartmentResponse.status, 400)

  const unrelatedFieldResponse = await fetch(`${baseUrl}/api/admin/users/${staffUser._id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ isActive: false, email: 'changed@example.test' }),
  })
  assert.equal(unrelatedFieldResponse.status, 400)

  const patchActivationResponse = await fetch(`${baseUrl}/api/admin/users/${staffUser._id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ isActive: false }),
  })
  assert.equal(patchActivationResponse.status, 400)
})

test('admin can activate and deactivate staff but cannot deactivate the last active admin', async () => {
  const email = `verifier-${runId}@example.test`
  createdEmails.push(email)
  const verifier = await User.create({
    email,
    displayName: 'Verifier User',
    passwordHash: await bcrypt.hash('VerifierPassword123!', 10),
    role: 'HUMAN_VERIFIER',
    departmentId: String(department._id),
    governmentOfficerId: 'GOV-2001',
    permissions: ['HUMAN_VERIFY_OCR'],
    isActive: false,
  })

  const activateResponse = await fetch(`${baseUrl}/api/admin/users/${verifier._id}/activate`, {
    method: 'POST',
    headers: adminHeaders(),
  })
  assert.equal(activateResponse.status, 200)
  const activated = await activateResponse.json()
  assert.equal(activated.user.isActive, true)

  const deactivateResponse = await fetch(`${baseUrl}/api/admin/users/${verifier._id}/deactivate`, {
    method: 'POST',
    headers: adminHeaders(),
  })
  assert.equal(deactivateResponse.status, 200)
  const deactivated = await deactivateResponse.json()
  assert.equal(deactivated.user.isActive, false)
  const inactiveLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'VerifierPassword123!' }),
  })
  assert.equal(inactiveLoginResponse.status, 401)

  const otherActiveAdmins = await User.countDocuments({
    role: 'ADMIN',
    isActive: true,
    _id: { $ne: adminUser._id },
  })
  if (otherActiveAdmins === 0) {
    const lastAdminAttempt = await fetch(`${baseUrl}/api/admin/users/${adminUser._id}/deactivate`, {
      method: 'POST',
      headers: adminHeaders(),
    })
    assert.equal(lastAdminAttempt.status, 400)
    const lastAdminBody = await lastAdminAttempt.json()
    assert.match(lastAdminBody.error, /last active Admin/i)
  }

  const latestAuditEvents = await AuditEvent.find({
    actorId: adminUser._id,
    action: { $in: ['USER_ACTIVATED', 'USER_DEACTIVATED'] },
  }).sort({ occurredAt: -1 }).limit(2).lean()
  assert.equal(latestAuditEvents.length, 2)
})

test('department deactivation preserves existing officer and application relationships', async () => {
  const officerEmail = `officer2-${runId}@example.test`
  createdEmails.push(officerEmail)
  const officer = await User.create({
    email: officerEmail,
    displayName: 'Second Officer',
    passwordHash: await bcrypt.hash('OfficerPassword456!', 10),
    role: 'OFFICER',
    departmentId: String(department._id),
    governmentOfficerId: 'GOV-3001',
    permissions: ['APPLICATION_VIEW_ASSIGNED'],
    isActive: true,
  })

  const deactivateDepartmentResponse = await fetch(`${baseUrl}/api/admin/departments/${department._id}/deactivate`, {
    method: 'POST',
    headers: adminHeaders(),
  })
  assert.equal(deactivateDepartmentResponse.status, 200)
  const departmentAfterDeactivation = await Department.findById(department._id).lean()
  assert.equal(departmentAfterDeactivation.isActive, false)
  assert.equal((await User.findById(officer._id).lean()).departmentId, String(department._id))

  const inactiveStaffEmail = `inactive-staff-${runId}@example.test`
  const inactiveStaff = await User.create({
    email: inactiveStaffEmail,
    displayName: 'Inactive Assigned Staff',
    passwordHash: await bcrypt.hash('OfficerPassword456!', 10),
    role: 'OFFICER',
    departmentId: String(department._id),
    governmentOfficerId: 'GOV-3002',
    permissions: ['APPLICATION_VIEW_ASSIGNED'],
    isActive: false,
  })
  createdEmails.push(inactiveStaffEmail)
  const applicant = await createApplicantUser(`department-applicant-${runId}@example.test`)
  const application = await Application.create({
    applicantId: applicant._id,
    applicationType: 'Department relationship check',
    applicationData: {
      title: 'Existing department application',
      applicantName: applicant.displayName,
      contactEmail: applicant.email,
      details: 'Keep the department association intact.',
    },
    departmentId: department._id,
  })

  const safeDeactivateResponse = await fetch(`${baseUrl}/api/admin/departments/${department._id}/deactivate`, {
    method: 'POST',
    headers: adminHeaders(),
  })
  assert.equal(safeDeactivateResponse.status, 200)
  const safeDeactivateBody = await safeDeactivateResponse.json()
  assert.equal(safeDeactivateBody.department.isActive, false)
  assert.ok(await Department.findById(department._id).lean())
  assert.equal((await User.findById(inactiveStaff._id).lean()).departmentId, String(department._id))
  assert.equal(String((await Application.findById(application._id).lean()).departmentId), String(department._id))

  const deactivateAudit = await AuditEvent.findOne({
    action: 'DEPARTMENT_DEACTIVATED',
    actorId: adminUser._id,
    reason: /Admin Department/,
  }).lean()
  assert.ok(deactivateAudit)

  const activateResponse = await fetch(`${baseUrl}/api/admin/departments/${department._id}/activate`, {
    method: 'POST',
    headers: adminHeaders(),
  })
  assert.equal(activateResponse.status, 200)
  assert.equal((await activateResponse.json()).department.isActive, true)
  assert.ok(await AuditEvent.findOne({
    action: 'DEPARTMENT_ACTIVATED',
    actorId: adminUser._id,
    reason: /Admin Department/,
  }).lean())
})

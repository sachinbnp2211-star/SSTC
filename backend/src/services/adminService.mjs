import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

import Application from '../models/Application.mjs'
import Department from '../models/Department.mjs'
import User from '../models/User.mjs'
import { ROLE_PERMISSIONS, serializeUser } from './authService.mjs'
import { createAuditEvent } from './auditService.mjs'
import { INITIAL_DEPARTMENTS } from './departmentSeedService.mjs'

const STAFF_ROLES = new Set(['OFFICER', 'GENERAL_OFFICER', 'HUMAN_VERIFIER'])
const DEPARTMENT_STAFF_ROLES = new Set(['OFFICER', 'GENERAL_OFFICER'])
const INITIAL_DEPARTMENT_CODES = new Set(INITIAL_DEPARTMENTS.map(({ code }) => code))

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function normalizeDepartmentCode(value) {
  return String(value || '').trim().toUpperCase()
}

function validateDepartmentName(value) {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  if (!name || name.length > 200) {
    throw requestError('Department name must be between 1 and 200 characters.', 400)
  }
  return name
}

function validateDepartmentDescription(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length > 1000) {
    throw requestError('Department description must be 1000 characters or fewer.', 400)
  }
  return value.trim()
}

function validateDepartmentCode(value) {
  const code = normalizeDepartmentCode(value)
  if (!/^[A-Z0-9][A-Z0-9_-]{0,49}$/.test(code)) {
    throw requestError('Department code must be 1-50 letters, numbers, hyphens, or underscores.', 400)
  }
  return code
}

function serializeDepartment(department) {
  if (!department) return null
  const serialized = { ...department, id: String(department._id || department.id) }
  delete serialized._id
  delete serialized.__v
  return serialized
}

function rethrowDuplicateDepartmentCode(error) {
  if (error?.code === 11000) {
    if (error?.keyPattern?.code || error?.message?.includes('department_code')) {
      throw requestError('A department with that code already exists.', 409)
    }
    if (error?.keyPattern?.name || error?.message?.includes('department_name_unique_ci')) {
      throw requestError('A department with that name already exists.', 409)
    }
  }
  throw error
}

async function findDepartmentNameConflict(name, excludeId = null) {
  const query = Department.findOne({
    name,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).collation({ locale: 'en', strength: 2 })
  return query.lean()
}

export function ensureValidStaffRole(role) {
  const normalizedRole = String(role || '').trim().toUpperCase()
  if (!STAFF_ROLES.has(normalizedRole)) {
    throw requestError('Staff roles are limited to OFFICER, GENERAL_OFFICER, and HUMAN_VERIFIER.', 400)
  }
  return normalizedRole
}

export async function countActiveAdmins(excludeUserId = null) {
  const query = { role: 'ADMIN', isActive: true }
  if (excludeUserId) query._id = { $ne: excludeUserId }
  return User.countDocuments(query)
}

async function ensureDepartmentAssignment(role, departmentId) {
  if (!departmentId) {
    throw requestError('A valid department assignment is required for staff users.', 400)
  }
  if (!mongoose.isValidObjectId(departmentId)) {
    throw requestError('Department assignment is invalid.', 400)
  }
  const department = await Department.findById(departmentId).lean()
  if (!department || !department.isActive) {
    throw requestError('The assigned department is not active or does not exist.', 400)
  }
  if (role === 'OFFICER' && !department.isActive) {
    throw requestError('Officers must be assigned to an active department.', 400)
  }
  return department
}

export async function getAdminOverview() {
  const [applicationCount, departmentCount, userCount, activeAdminCount, processingTotals] = await Promise.all([
    Application.countDocuments(),
    Department.countDocuments(),
    User.countDocuments(),
    countActiveAdmins(),
    Application.aggregate([
      { $match: { processingDecision: { $in: ['AUTO_PROCESSED', 'HUMAN_VERIFICATION'] } } },
      {
        $group: {
          _id: null,
          autoProcessedCount: {
            $sum: { $cond: [{ $eq: ['$processingDecision', 'AUTO_PROCESSED'] }, 1, 0] },
          },
          humanVerificationCount: {
            $sum: { $cond: [{ $eq: ['$processingDecision', 'HUMAN_VERIFICATION'] }, 1, 0] },
          },
          requiredFieldCount: { $sum: '$automationAssessment.requiredFieldCount' },
          completeFieldCount: { $sum: '$automationAssessment.completeFieldCount' },
          evidenceSupportedFieldCount: { $sum: '$automationAssessment.evidenceSupportedFieldCount' },
          confidenceQualifiedFieldCount: { $sum: '$automationAssessment.confidenceQualifiedFieldCount' },
        },
      },
    ]),
  ])
  const totals = processingTotals[0] || {}
  const decisionedApplicationCount = (totals.autoProcessedCount || 0) + (totals.humanVerificationCount || 0)
  const requiredFieldCount = totals.requiredFieldCount || 0
  const toPercentage = (numerator, denominator) => denominator
    ? Math.round((numerator / denominator) * 1000) / 10
    : null

  return {
    applicationCount,
    departmentCount,
    userCount,
    activeAdminCount,
    automationMetrics: {
      decisionedApplicationCount,
      autoProcessedCount: totals.autoProcessedCount || 0,
      humanVerificationCount: totals.humanVerificationCount || 0,
      automationRate: toPercentage(totals.autoProcessedCount || 0, decisionedApplicationCount),
      requiredFieldCount,
      completeFieldCount: totals.completeFieldCount || 0,
      evidenceSupportedFieldCount: totals.evidenceSupportedFieldCount || 0,
      confidenceQualifiedFieldCount: totals.confidenceQualifiedFieldCount || 0,
      fieldCompletenessRate: toPercentage(totals.completeFieldCount || 0, requiredFieldCount),
      evidenceSupportRate: toPercentage(totals.evidenceSupportedFieldCount || 0, requiredFieldCount),
      fieldConfidenceQualificationRate: toPercentage(
        totals.confidenceQualifiedFieldCount || 0,
        requiredFieldCount,
      ),
    },
  }
}

export async function listUsers() {
  const users = await User.find({}).sort({ createdAt: -1 }).lean()
  return users.map((user) => serializeUser(user))
}

export async function getUserById(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw requestError('User not found.', 404)
  }
  const user = await User.findById(userId).lean()
  if (!user) throw requestError('User not found.', 404)
  return serializeUser(user)
}

export async function createStaffUser({ actor, email, password, displayName, role, departmentId, governmentOfficerId }) {
  if (!actor?.id || !mongoose.isValidObjectId(actor.id)) {
    throw requestError('An authenticated admin actor is required.', 401)
  }

  const normalizedRole = ensureValidStaffRole(role)
  if (normalizedRole === 'OFFICER') {
    throw requestError('Officers must register with a Government Officer ID and receive Admin approval.', 400)
  }
  if (normalizedRole === 'HUMAN_VERIFIER') {
    throw requestError('Human Verifiers must complete self-registration and receive Admin approval.', 400)
  }
  if (normalizedRole === 'GENERAL_OFFICER') {
    throw requestError('General Officers must register with a Government Officer ID and receive Admin approval.', 400)
  }
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw requestError('A valid staff email is required.', 400)
  }
  if (!displayName || !String(displayName).trim()) {
    throw requestError('A valid display name is required.', 400)
  }
  if (!password || String(password).length < 8) {
    throw requestError('A password of at least 8 characters is required.', 400)
  }

  const officerId = String(governmentOfficerId || '').trim()
  if (!officerId) {
    throw requestError('A government officer ID is required for staff users.', 400)
  }

  await ensureDepartmentAssignment(normalizedRole, departmentId)

  const existingUser = await User.findOne({ email: normalizedEmail }).lean()
  if (existingUser) {
    throw requestError('An account with that email already exists.', 409)
  }

  const passwordHash = await bcrypt.hash(String(password), 10)
  const user = await User.create({
    email: normalizedEmail,
    displayName: String(displayName).trim(),
    passwordHash,
    role: normalizedRole,
    departmentId: String(departmentId),
    governmentOfficerId: officerId,
    permissions: ROLE_PERMISSIONS[normalizedRole] || [],
    isActive: true,
    accountStatus: 'ACTIVE',
  })

  await createAuditEvent({
    actor,
    action: 'USER_CREATED',
    reason: `Created ${normalizedRole} staff user ${normalizedEmail}.`,
  })

  return serializeUser(user.toObject())
}

export async function updateStaffUser({ actor, userId, updates = {}, allowStatusChange = false }) {
  if (!actor?.id || !mongoose.isValidObjectId(actor.id)) {
    throw requestError('An authenticated admin actor is required.', 401)
  }
  if (!mongoose.isValidObjectId(userId)) {
    throw requestError('User not found.', 404)
  }
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw requestError('User updates must be an object.', 400)
  }
  const supportedFields = new Set(['role', 'departmentId', 'governmentOfficerId'])
  if (allowStatusChange) supportedFields.add('isActive')
  if (Object.keys(updates).some((field) => !supportedFields.has(field))) {
    throw requestError('Only role, department, government officer ID, and activation status can be updated.', 400)
  }

  const currentUser = await User.findById(userId)
  if (!currentUser) throw requestError('User not found.', 404)

  const isStaffUser = STAFF_ROLES.has(currentUser.role)
  const statusRequested = allowStatusChange && updates.isActive !== undefined
  const staffFieldsRequested = ['role', 'departmentId', 'governmentOfficerId']
    .some((field) => updates[field] !== undefined)
  if (!isStaffUser && !(currentUser.role === 'ADMIN' && statusRequested && !staffFieldsRequested)) {
    throw requestError('Only staff users can be updated or activated.', 400)
  }
  if (['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'].includes(currentUser.role) &&
      ['PENDING', 'REJECTED'].includes(currentUser.accountStatus) &&
      statusRequested) {
    throw requestError('Pending or rejected Officers can only be activated through registration approval.', 409)
  }

  if (!staffFieldsRequested && !statusRequested) {
    throw requestError('At least one user field must be updated.', 400)
  }

  let nextRole = currentUser.role
  let nextDepartmentId = currentUser.departmentId
  let nextGovernmentOfficerId = currentUser.governmentOfficerId
  if (staffFieldsRequested) {
    nextRole = updates.role !== undefined
      ? ensureValidStaffRole(updates.role)
      : currentUser.role
    if (nextRole === 'OFFICER' && currentUser.role !== 'OFFICER') {
      throw requestError('Officers must register with a Government Officer ID and receive Admin approval.', 400)
    }
    if (nextRole === 'HUMAN_VERIFIER' && currentUser.role !== 'HUMAN_VERIFIER') {
      throw requestError('Human Verifier role assignments can only be made through the registration approval flow.', 400)
    }
    if (nextRole === 'GENERAL_OFFICER' && currentUser.role !== 'GENERAL_OFFICER') {
      throw requestError('General Officers must register with a Government Officer ID and receive Admin approval.', 400)
    }
    if (!DEPARTMENT_STAFF_ROLES.has(nextRole)) {
      throw requestError('Human Verifiers do not have Department assignments.', 400)
    }
    nextDepartmentId = updates.departmentId !== undefined
      ? String(updates.departmentId || '').trim()
      : currentUser.departmentId
    await ensureDepartmentAssignment(nextRole, nextDepartmentId)

    nextGovernmentOfficerId = updates.governmentOfficerId !== undefined
      ? String(updates.governmentOfficerId || '').trim()
      : currentUser.governmentOfficerId
    if (!nextGovernmentOfficerId) {
      throw requestError('A government officer ID is required for staff users.', 400)
    }
  }

  const isRoleChange = nextRole !== currentUser.role
  const isDepartmentChange = String(nextDepartmentId) !== String(currentUser.departmentId)
  const isOfficerIdChange = nextGovernmentOfficerId !== currentUser.governmentOfficerId
  const isDeactivation = updates.isActive !== undefined && updates.isActive === false && currentUser.isActive
  const isActivation = updates.isActive !== undefined && updates.isActive === true && !currentUser.isActive

  if (isDeactivation) {
    const remainingAdmins = await countActiveAdmins(String(currentUser._id))
    if (currentUser.role === 'ADMIN' && remainingAdmins === 0) {
      throw requestError('The last active Admin account cannot be deactivated.', 400)
    }
  }

  const previousStatus = currentUser.isActive ? 'ACTIVE' : 'INACTIVE'
  const patch = {}
  if (staffFieldsRequested) {
    patch.role = nextRole
    patch.departmentId = String(nextDepartmentId)
    patch.governmentOfficerId = nextGovernmentOfficerId
    if (isRoleChange) patch.permissions = ROLE_PERMISSIONS[nextRole] || []
  }
  if (statusRequested) patch.isActive = Boolean(updates.isActive)
  if (statusRequested && ['OFFICER', 'HUMAN_VERIFIER'].includes(currentUser.role)) {
    patch.accountStatus = updates.isActive ? 'ACTIVE' : 'SUSPENDED'
  }

  const updatedUser = await User.findByIdAndUpdate(userId, patch, { new: true, runValidators: true }).lean()

  if (isRoleChange || isDeactivation || isActivation || isDepartmentChange || isOfficerIdChange) {
    const action = isActivation
      ? 'USER_ACTIVATED'
      : isDeactivation
        ? 'USER_DEACTIVATED'
        : isRoleChange
          ? 'USER_ROLE_UPDATED'
          : 'USER_UPDATED'
    const changes = []
    if (isRoleChange) changes.push(`role from ${currentUser.role} to ${nextRole}`)
    if (isDepartmentChange) changes.push('department assignment')
    if (isOfficerIdChange) changes.push('government officer ID')
    if (isDeactivation) changes.push('deactivation')
    if (isActivation) changes.push('activation')

    await createAuditEvent({
      actor,
      action,
      previousStatus: isActivation || isDeactivation ? previousStatus : null,
      newStatus: isActivation || isDeactivation ? (patch.isActive ? 'ACTIVE' : 'INACTIVE') : null,
      reason: `Updated user ${currentUser.email}: ${changes.join(', ')}.`,
    })
  }

  return serializeUser(updatedUser)
}

export async function activateUser({ actor, userId }) {
  return updateStaffUser({ actor, userId, updates: { isActive: true }, allowStatusChange: true })
}

export async function deactivateUser({ actor, userId }) {
  return updateStaffUser({ actor, userId, updates: { isActive: false }, allowStatusChange: true })
}

export async function listDepartments() {
  const [departments, officerCounts, staffReferenceCounts, applicationCounts] = await Promise.all([
    Department.find({}).sort({ name: 1 }).lean(),
    User.aggregate([
      { $match: { role: 'OFFICER', departmentId: { $type: 'string' } } },
      { $group: { _id: '$departmentId', count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $match: { role: { $in: [...DEPARTMENT_STAFF_ROLES] }, departmentId: { $type: 'string' } } },
      { $group: { _id: '$departmentId', count: { $sum: 1 } } },
    ]),
    Application.aggregate([
      { $match: { departmentId: { $ne: null } } },
      {
        $group: {
          _id: '$departmentId',
          applicationCount: { $sum: 1 },
          pendingApplicationCount: {
            $sum: {
              $cond: [{ $in: ['$status', ['ASSIGNED', 'UNDER_REVIEW']] }, 1, 0],
            },
          },
        },
      },
    ]),
  ])
  const officersByDepartment = new Map(officerCounts.map(({ _id, count }) => [String(_id), count]))
  const staffByDepartment = new Map(staffReferenceCounts.map(({ _id, count }) => [String(_id), count]))
  const pendingApplicationsByDepartment = new Map(applicationCounts.map(({ _id, pendingApplicationCount }) => [String(_id), pendingApplicationCount]))
  const applicationsByDepartment = new Map(applicationCounts.map(({ _id, applicationCount }) => [String(_id), applicationCount]))
  return departments.map((department) => ({
    ...serializeDepartment(department),
    officerCount: officersByDepartment.get(String(department._id)) || 0,
    pendingApplicationCount: pendingApplicationsByDepartment.get(String(department._id)) || 0,
    isCodeEditable: !INITIAL_DEPARTMENT_CODES.has(department.code) &&
      !staffByDepartment.get(String(department._id)) &&
      !applicationsByDepartment.get(String(department._id)),
  }))
}

export async function getDepartmentById(departmentId) {
  if (!mongoose.isValidObjectId(departmentId)) {
    throw requestError('Department not found.', 404)
  }
  const department = await Department.findById(departmentId).lean()
  if (!department) throw requestError('Department not found.', 404)
  return serializeDepartment(department)
}

export async function createDepartment({ actor, name, code, description, isActive = true }) {
  if (!actor?.id || !mongoose.isValidObjectId(actor.id)) {
    throw requestError('An authenticated admin actor is required.', 401)
  }

  const nextName = validateDepartmentName(name)
  const nextCode = validateDepartmentCode(code)
  const nextDescription = validateDepartmentDescription(description) ?? ''
  if (typeof isActive !== 'boolean') {
    throw requestError('Department status must be active or inactive.', 400)
  }

  const [existingCode, existingName] = await Promise.all([
    Department.findOne({ code: nextCode }).lean(),
    findDepartmentNameConflict(nextName),
  ])
  if (existingCode) {
    throw requestError('A department with that code already exists.', 409)
  }
  if (existingName) {
    throw requestError('A department with that name already exists.', 409)
  }

  let department
  try {
    department = await Department.create({
      name: nextName,
      code: nextCode,
      description: nextDescription,
      isActive,
    })
  } catch (error) {
    rethrowDuplicateDepartmentCode(error)
  }

  await createAuditEvent({
    actor,
    action: 'DEPARTMENT_CREATED',
    reason: `Created department ${nextName} (${nextCode}).`,
  })

  return serializeDepartment(department.toObject())
}

export async function updateDepartment({ actor, departmentId, updates = {} }) {
  if (!actor?.id || !mongoose.isValidObjectId(actor.id)) {
    throw requestError('An authenticated admin actor is required.', 401)
  }
  if (!mongoose.isValidObjectId(departmentId)) {
    throw requestError('Department not found.', 404)
  }
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw requestError('Department updates must be an object.', 400)
  }
  if (Object.keys(updates).some((field) => !['name', 'code', 'description'].includes(field))) {
    throw requestError('Only department name, code, and description can be updated.', 400)
  }
  if (Object.keys(updates).length === 0) {
    throw requestError('At least one department field must be updated.', 400)
  }

  const currentDepartment = await Department.findById(departmentId)
  if (!currentDepartment) throw requestError('Department not found.', 404)

  const nextName = updates.name !== undefined ? validateDepartmentName(updates.name) : currentDepartment.name
  const nextCode = updates.code !== undefined ? validateDepartmentCode(updates.code) : currentDepartment.code
  const nextDescription = updates.description !== undefined
    ? validateDepartmentDescription(updates.description)
    : currentDepartment.description || ''

  if (nextName !== currentDepartment.name) {
    const duplicateName = await findDepartmentNameConflict(nextName, currentDepartment._id)
    if (duplicateName) throw requestError('A department with that name already exists.', 409)
  }
  if (nextCode !== currentDepartment.code) {
    const duplicate = await Department.findOne({ code: nextCode, _id: { $ne: currentDepartment._id } }).lean()
    if (duplicate) throw requestError('A department with that code already exists.', 409)
    if (INITIAL_DEPARTMENT_CODES.has(currentDepartment.code)) {
      throw requestError('Initial department codes are stable and cannot be changed.', 409)
    }
    const [assignedStaff, assignedApplication] = await Promise.all([
      User.exists({
        departmentId: String(currentDepartment._id),
        role: { $in: [...STAFF_ROLES] },
      }),
      Application.exists({ departmentId: currentDepartment._id }),
    ])
    if (assignedStaff || assignedApplication) {
      throw requestError('Department codes cannot be changed while officers or applications reference the department.', 409)
    }
  }

  let updatedDepartment
  try {
    updatedDepartment = await Department.findByIdAndUpdate(
      departmentId,
      { name: nextName, code: nextCode, description: nextDescription },
      { new: true, runValidators: true },
    ).lean()
  } catch (error) {
    rethrowDuplicateDepartmentCode(error)
  }

  if (nextName !== currentDepartment.name || nextCode !== currentDepartment.code || nextDescription !== (currentDepartment.description || '')) {
    await createAuditEvent({
      actor,
      action: 'DEPARTMENT_UPDATED',
      reason: `Updated department ${currentDepartment.name} (${currentDepartment.code}) to ${nextName} (${nextCode}).`,
    })
  }

  return serializeDepartment(updatedDepartment)
}

export async function activateDepartment({ actor, departmentId }) {
  return setDepartmentActive({ actor, departmentId, isActive: true })
}

export async function deactivateDepartment({ actor, departmentId }) {
  return setDepartmentActive({ actor, departmentId, isActive: false })
}

async function setDepartmentActive({ actor, departmentId, isActive }) {
  if (!actor?.id || !mongoose.isValidObjectId(actor.id)) {
    throw requestError('An authenticated admin actor is required.', 401)
  }
  if (!mongoose.isValidObjectId(departmentId)) {
    throw requestError('Department not found.', 404)
  }

  const department = await Department.findById(departmentId)
  if (!department) throw requestError('Department not found.', 404)
  if (department.isActive === isActive) return serializeDepartment(department.toObject())

  department.isActive = isActive
  await department.save()
  await createAuditEvent({
    actor,
    action: isActive ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_DEACTIVATED',
    previousStatus: isActive ? 'INACTIVE' : 'ACTIVE',
    newStatus: isActive ? 'ACTIVE' : 'INACTIVE',
    reason: `${isActive ? 'Activated' : 'Deactivated'} department ${department.name} (${department.code}).`,
  })
  return serializeDepartment(department.toObject())
}

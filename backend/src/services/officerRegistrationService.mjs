import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

import { env } from '../config/env.mjs'
import Department from '../models/Department.mjs'
import GovernmentOfficerRegistry from '../models/GovernmentOfficerRegistry.mjs'
import User from '../models/User.mjs'
import { ROLE_PERMISSIONS, normalizeEmail, serializeUser } from './authService.mjs'
import { createAuditEvent } from './auditService.mjs'
import { sendOfficerSetupLink } from './emailService.mjs'

const setupTokenLifetimeMs = 24 * 60 * 60 * 1000
const registrationAccessTokenLifetimeMs = 90 * 24 * 60 * 60 * 1000
const governmentOfficerIdPattern = /^[A-Z]{3}-[0-9]{3}$/

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function hashSetupToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function validateRegistration({ governmentOfficerId, displayName, email }) {
  const normalizedGovernmentOfficerId = String(governmentOfficerId || '').trim().toUpperCase()
  const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : ''
  const normalizedEmail = email ? normalizeEmail(email) : ''
  if (!governmentOfficerIdPattern.test(normalizedGovernmentOfficerId)) {
    throw requestError('Enter a valid Government Officer ID.', 400)
  }
  if (displayName !== undefined && (!normalizedDisplayName || normalizedDisplayName.length > 160)) {
    throw requestError('Enter the registered Officer name.', 400)
  }
  if (email !== undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254)) {
    throw requestError('Enter a valid official email address.', 400)
  }
  return { normalizedGovernmentOfficerId, normalizedDisplayName, normalizedEmail }
}

export async function validateOfficerRegistration({ governmentOfficerId, role = 'OFFICER' }) {
  const normalizedRole = String(role).toUpperCase()
  if (!['OFFICER', 'GENERAL_OFFICER'].includes(normalizedRole)) {
    throw requestError('Choose a supported registration type.', 400)
  }
  const input = validateRegistration({ governmentOfficerId })
  const registryEntry = await GovernmentOfficerRegistry.findOne({
    governmentOfficerId: input.normalizedGovernmentOfficerId,
  }).lean()
  if (!registryEntry) throw requestError('Government Officer ID was not found.', 404)
  if (!registryEntry.isActive) throw requestError('This Government Officer ID is inactive.', 403)

  const department = await Department.findById(registryEntry.departmentId).lean()
  if (!department || !department.isActive) {
    throw requestError('This Government Officer ID is inactive.', 403)
  }
  const existingOfficer = await User.findOne({
    governmentOfficerId: input.normalizedGovernmentOfficerId,
  }).lean()
  if (existingOfficer) {
    if (existingOfficer.role !== normalizedRole) {
      throw requestError('This Government Officer ID is already associated with an account.', 409)
    }
    if (existingOfficer.accountStatus === 'PENDING') {
      throw requestError('Your registration is already awaiting administrator approval.', 409)
    }
    if (existingOfficer.accountStatus === 'ACTIVE' || !existingOfficer.accountStatus && existingOfficer.isActive) {
      throw requestError(`This ${normalizedRole === 'GENERAL_OFFICER' ? 'General Officer' : 'officer'} already has an account.`, 409)
    }
    if (existingOfficer.accountStatus === 'SUSPENDED' ||
        (!existingOfficer.accountStatus && !existingOfficer.isActive)) {
      throw requestError('This Government Officer ID is inactive.', 403)
    }
    if (existingOfficer.accountStatus !== 'REJECTED') {
      throw requestError('This Officer account cannot be registered again.', 409)
    }
  }
  return {
    valid: true,
    governmentOfficerId: input.normalizedGovernmentOfficerId,
    displayName: registryEntry.displayName,
    officialEmail: registryEntry.officialEmail,
    department: { id: String(department._id), name: department.name, code: department.code },
    reRegistered: Boolean(existingOfficer),
  }
}

export async function registerOfficer({ governmentOfficerId, displayName, email, role = 'OFFICER' }) {
  const normalizedRole = String(role).toUpperCase()
  if (!['OFFICER', 'GENERAL_OFFICER'].includes(normalizedRole)) {
    throw requestError('Choose a supported registration type.', 400)
  }
  const input = validateRegistration({ governmentOfficerId, displayName, email })
  const registryEntry = await GovernmentOfficerRegistry.findOne({
    governmentOfficerId: input.normalizedGovernmentOfficerId,
  }).lean()
  if (!registryEntry || !registryEntry.isActive) {
    throw requestError(
      registryEntry ? 'This Government Officer ID is inactive.' : 'Government Officer ID was not found.',
      registryEntry ? 403 : 404,
    )
  }
  if (input.normalizedDisplayName &&
      registryEntry.displayName.toLowerCase() !== input.normalizedDisplayName.toLowerCase()) {
    throw requestError('The name does not match the Government Officer registry.', 400)
  }
  if (input.normalizedEmail && registryEntry.officialEmail !== input.normalizedEmail) {
    throw requestError('The email does not match the registered official email.', 400)
  }

  const department = await Department.findById(registryEntry.departmentId).lean()
  if (!department || !department.isActive) {
    throw requestError('This Government Officer ID is inactive.', 403)
  }
  const registeredEmail = registryEntry.officialEmail
  const registrationAccessToken = randomBytes(32).toString('base64url')
  const registrationAccessTokenHash = hashSetupToken(registrationAccessToken)
  const registrationAccessTokenExpiresAt = new Date(Date.now() + registrationAccessTokenLifetimeMs)

  const existingOfficer = await User.findOne({
    governmentOfficerId: input.normalizedGovernmentOfficerId,
  }).select('+setupTokenHash +setupTokenExpiresAt').lean()
  if (existingOfficer) {
    if (existingOfficer.role !== normalizedRole) {
      throw requestError('This Government Officer ID is already associated with an account.', 409)
    }
    if (existingOfficer.accountStatus === 'PENDING') {
      throw requestError('Your registration is already awaiting administrator approval.', 409)
    }
    if (existingOfficer.accountStatus === 'ACTIVE' || !existingOfficer.accountStatus && existingOfficer.isActive) {
      throw requestError(`This ${normalizedRole === 'GENERAL_OFFICER' ? 'General Officer' : 'officer'} already has an account.`, 409)
    }
    if (existingOfficer.accountStatus === 'SUSPENDED' ||
        (!existingOfficer.accountStatus && !existingOfficer.isActive)) {
      throw requestError('This Government Officer ID is inactive.', 403)
    }
    if (existingOfficer.accountStatus !== 'REJECTED') {
      throw requestError('This Officer account cannot be registered again.', 409)
    }

    const emailOwner = await User.findOne({
      email: registeredEmail,
      _id: { $ne: existingOfficer._id },
    }).select('_id').lean()
    if (emailOwner) throw requestError('This official email is already associated with another account.', 409)

    const reactivated = await User.findOneAndUpdate(
      { _id: existingOfficer._id, role: normalizedRole, accountStatus: 'REJECTED' },
      {
        $set: {
          email: registeredEmail,
          displayName: registryEntry.displayName,
          departmentId: String(department._id),
          accountStatus: 'PENDING',
          isActive: false,
          permissions: ROLE_PERMISSIONS[normalizedRole],
          officerRejectedAt: null,
          officerRejectedBy: null,
          officerRejectionReason: null,
          mustChangePassword: false,
          registrationAccessTokenHash,
          registrationAccessTokenExpiresAt,
        },
        $unset: {
          passwordHash: 1,
          setupTokenHash: 1,
          setupTokenExpiresAt: 1,
          officerApprovedAt: 1,
          officerApprovedBy: 1,
        },
      },
      { new: true, runValidators: true },
    ).lean()
    if (!reactivated) throw requestError('Registration changed while being submitted; please try again.', 409)
    return {
      user: serializeUser(reactivated),
      department: { id: String(department._id), name: department.name, code: department.code },
      reRegistered: true,
      registrationAccessToken,
      registrationAccessExpiresAt: registrationAccessTokenExpiresAt,
    }
  }

  const emailOwner = await User.findOne({ email: registeredEmail }).select('_id').lean()
  if (emailOwner) throw requestError('This official email is already associated with an account.', 409)

  try {
    const user = await User.create({
      email: registeredEmail,
      displayName: registryEntry.displayName,
      role: normalizedRole,
      departmentId: String(department._id),
      governmentOfficerId: input.normalizedGovernmentOfficerId,
      permissions: ROLE_PERMISSIONS[normalizedRole],
      accountStatus: 'PENDING',
      isActive: false,
      mustChangePassword: false,
      registrationAccessTokenHash,
      registrationAccessTokenExpiresAt,
    })
    await createAuditEvent({
      actor: { id: String(user._id), role: normalizedRole },
      action: `${normalizedRole}_REGISTRATION_SUBMITTED`,
      newStatus: 'PENDING',
      reason: `${normalizedRole === 'GENERAL_OFFICER' ? 'General Officer' : 'Officer'} registration submitted for ${input.normalizedGovernmentOfficerId}.`,
    })
    return {
      user: serializeUser(user.toObject()),
      department: { id: String(department._id), name: department.name, code: department.code },
      reRegistered: false,
      registrationAccessToken,
      registrationAccessExpiresAt: registrationAccessTokenExpiresAt,
    }
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await User.findOne({
        $or: [
          { email: input.normalizedEmail },
          { governmentOfficerId: input.normalizedGovernmentOfficerId },
        ],
      }).select('accountStatus isActive').lean()
      if (duplicate?.accountStatus === 'PENDING') {
        throw requestError('Registration is already pending Admin approval.', 409)
      }
      throw requestError('An account already exists for this email or Government Officer ID.', 409)
    }
    throw error
  }
}

export async function registerHumanVerifier({
  email,
  displayName,
}) {
  const normalizedEmail = normalizeEmail(email)
  const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw requestError('Enter a valid official email address.', 400)
  }
  if (!normalizedDisplayName || normalizedDisplayName.length > 160) {
    throw requestError('Enter your full registered name.', 400)
  }
  const existingUser = await User.findOne({ email: normalizedEmail }).lean()
  const registrationAccessToken = randomBytes(32).toString('base64url')
  const registrationAccessTokenHash = hashSetupToken(registrationAccessToken)
  const registrationAccessTokenExpiresAt = new Date(Date.now() + registrationAccessTokenLifetimeMs)
  let user

  if (existingUser) {
    if (existingUser.role !== 'HUMAN_VERIFIER' || existingUser.accountStatus !== 'REJECTED') {
      throw requestError('An account already exists for this official email.', 409)
    }
    user = await User.findOneAndUpdate(
      { _id: existingUser._id, role: 'HUMAN_VERIFIER', accountStatus: 'REJECTED' },
      {
        $set: {
          displayName: normalizedDisplayName,
          departmentId: null,
          governmentOfficerId: null,
          accountStatus: 'PENDING',
          isActive: false,
          permissions: ROLE_PERMISSIONS.HUMAN_VERIFIER,
          officerRejectedAt: null,
          officerRejectedBy: null,
          officerRejectionReason: null,
          mustChangePassword: false,
          registrationAccessTokenHash,
          registrationAccessTokenExpiresAt,
        },
        $unset: {
          passwordHash: 1,
          setupTokenHash: 1,
          setupTokenExpiresAt: 1,
          officerApprovedAt: 1,
          officerApprovedBy: 1,
        },
      },
      { new: true, runValidators: true },
    ).lean()
    if (!user) throw requestError('Registration changed while being submitted; please try again.', 409)
  } else {
    user = await User.create({
      email: normalizedEmail,
      displayName: normalizedDisplayName,
      role: 'HUMAN_VERIFIER',
      departmentId: null,
      governmentOfficerId: null,
      permissions: ROLE_PERMISSIONS.HUMAN_VERIFIER,
      accountStatus: 'PENDING',
      isActive: false,
      mustChangePassword: false,
      registrationAccessTokenHash,
      registrationAccessTokenExpiresAt,
    })
  }

  await createAuditEvent({
    actor: { id: String(user._id), role: 'HUMAN_VERIFIER' },
    action: 'HUMAN_VERIFIER_REGISTRATION_SUBMITTED',
    newStatus: 'PENDING',
    reason: `Human Verifier registration submitted for ${normalizedEmail}.`,
  })
  return {
    user: serializeUser(user.toObject ? user.toObject() : user),
    department: null,
    status: 'PENDING',
    reRegistered: Boolean(existingUser),
    registrationAccessToken,
    registrationAccessExpiresAt: registrationAccessTokenExpiresAt,
  }
}

export async function completeOfficerPasswordSetup({
  setupToken,
  temporaryPassword,
  role = 'OFFICER',
}) {
  if (typeof setupToken !== 'string' || setupToken.length < 32 || setupToken.length > 200) {
    throw requestError('This setup link is invalid or expired.', 400)
  }
  if (typeof temporaryPassword !== 'string' || temporaryPassword.length < 12 || temporaryPassword.length > 128) {
    throw requestError('Choose a password between 12 and 128 characters.', 400)
  }

  const normalizedRole = String(role).toUpperCase()
  if (!['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'].includes(normalizedRole)) {
    throw requestError('This setup link is invalid or expired.', 400)
  }
  const now = new Date()
  const tokenHash = hashSetupToken(setupToken)
  const officer = await User.findOne({
    role: normalizedRole,
    accountStatus: 'ACTIVE',
    isActive: true,
    mustChangePassword: true,
    setupTokenHash: tokenHash,
    setupTokenExpiresAt: { $gt: now },
  }).select('+setupTokenHash +setupTokenExpiresAt').lean()
  if (!officer) throw requestError('This setup link is invalid, expired, or already used.', 400)

  const passwordHash = await bcrypt.hash(temporaryPassword, 10)
  const updated = await User.findOneAndUpdate(
    {
      _id: officer._id,
      role: normalizedRole,
      accountStatus: 'ACTIVE',
      setupTokenHash: tokenHash,
      setupTokenExpiresAt: { $gt: now },
    },
    {
      $set: { passwordHash, mustChangePassword: false },
      $unset: {
        setupTokenHash: 1,
        setupTokenExpiresAt: 1,
        registrationAccessTokenHash: 1,
        registrationAccessTokenExpiresAt: 1,
      },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw requestError('This setup link is invalid, expired, or already used.', 400)
  return serializeUser(updated)
}

export async function getOfficerRegistrationStatus({
  role = 'OFFICER',
  governmentOfficerId,
  email,
  registrationAccessToken,
}) {
  const normalizedRole = String(role).toUpperCase()
  if (!['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'].includes(normalizedRole)) {
    throw requestError('Registration status is unavailable for this role.', 400)
  }
  let identifier
  if (normalizedRole === 'OFFICER' || normalizedRole === 'GENERAL_OFFICER') {
    const input = validateRegistration({ governmentOfficerId })
    const registryEntry = await GovernmentOfficerRegistry.findOne({
      governmentOfficerId: input.normalizedGovernmentOfficerId,
      isActive: true,
    }).select('_id').lean()
    if (!registryEntry) throw requestError('Government Officer ID was not found or is inactive.', 404)
    identifier = { governmentOfficerId: input.normalizedGovernmentOfficerId }
  } else {
    const normalizedEmail = normalizeEmail(email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      throw requestError('Enter the official email address used during registration.', 400)
    }
    identifier = { email: normalizedEmail }
  }
  const now = new Date()
  const officer = await User.findOne({ role: normalizedRole, ...identifier })
    .select('+registrationAccessTokenHash +registrationAccessTokenExpiresAt +setupTokenHash +setupTokenExpiresAt')
    .lean()
  if (!officer) {
    return {
      ...(normalizedRole === 'OFFICER' || normalizedRole === 'GENERAL_OFFICER' ? { governmentOfficerId: identifier.governmentOfficerId } : { email: identifier.email }),
      status: 'NOT_REGISTERED',
      passwordSetupAvailable: false,
    }
  }

  const approved = officer.accountStatus === 'ACTIVE' && officer.isActive &&
    !officer.passwordHash
  const active = (officer.accountStatus === 'ACTIVE' || officer.accountStatus === null) &&
    officer.isActive && !officer.mustChangePassword && Boolean(officer.passwordHash)
  const status = approved
    ? 'APPROVED'
    : active
      ? 'ACTIVE'
      : ['PENDING', 'REJECTED', 'SUSPENDED'].includes(officer.accountStatus)
        ? officer.accountStatus
        : 'SUSPENDED'
  const suppliedTokenHash = typeof registrationAccessToken === 'string' &&
    registrationAccessToken.length >= 32 && registrationAccessToken.length <= 200
    ? hashSetupToken(registrationAccessToken)
    : null
  const ownsRegistration = Boolean(
    suppliedTokenHash &&
    officer.registrationAccessTokenHash === suppliedTokenHash &&
    officer.registrationAccessTokenExpiresAt > now,
  )
  const passwordSetupAvailable = Boolean(
    ownsRegistration &&
    approved &&
    officer.mustChangePassword &&
    officer.setupTokenHash &&
    officer.setupTokenExpiresAt &&
    officer.setupTokenExpiresAt > now,
  )
  return {
    ...(normalizedRole === 'OFFICER' || normalizedRole === 'GENERAL_OFFICER' ? { governmentOfficerId: identifier.governmentOfficerId } : { email: identifier.email }),
    status,
    passwordSetupAvailable,
    ...(passwordSetupAvailable
      ? {
        passwordSetupUrl: normalizedRole === 'OFFICER'
          ? `/officer/setup?registration=1&officerId=${encodeURIComponent(identifier.governmentOfficerId)}`
          : normalizedRole === 'GENERAL_OFFICER'
            ? `/general-officer/setup?registration=1&officerId=${encodeURIComponent(identifier.governmentOfficerId)}`
            : `/human-verifier/setup?registration=1&email=${encodeURIComponent(identifier.email)}`,
      }
      : {}),
    ...(ownsRegistration && officer.accountStatus === 'REJECTED' && officer.officerRejectionReason
      ? { rejectionReason: officer.officerRejectionReason }
      : {}),
  }
}

export async function completeOfficerRegistrationPasswordSetup({
  role = 'OFFICER',
  governmentOfficerId,
  email,
  registrationAccessToken,
  temporaryPassword,
}) {
  if (typeof registrationAccessToken !== 'string' ||
      registrationAccessToken.length < 32 || registrationAccessToken.length > 200) {
    throw requestError('Officer registration status authorization is required.', 401)
  }
  if (typeof temporaryPassword !== 'string' || temporaryPassword.length < 12 || temporaryPassword.length > 128) {
    throw requestError('Choose a password between 12 and 128 characters.', 400)
  }
  const normalizedRole = String(role).toUpperCase()
  if (!['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'].includes(normalizedRole)) {
    throw requestError('Password setup is unavailable for this role.', 403)
  }
  const identifier = normalizedRole === 'OFFICER' || normalizedRole === 'GENERAL_OFFICER'
    ? { governmentOfficerId: validateRegistration({ governmentOfficerId }).normalizedGovernmentOfficerId }
    : { email: normalizeEmail(email) }
  if (normalizedRole === 'HUMAN_VERIFIER' &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.email)) {
    throw requestError('Enter the official email address used during registration.', 400)
  }

  const now = new Date()
  const registrationAccessTokenHash = hashSetupToken(registrationAccessToken)
  const officer = await User.findOne({
    role: normalizedRole,
    ...identifier,
    registrationAccessTokenHash,
    registrationAccessTokenExpiresAt: { $gt: now },
  }).select('+registrationAccessTokenHash +registrationAccessTokenExpiresAt +setupTokenHash +setupTokenExpiresAt').lean()
  if (!officer) throw requestError('Registration status authorization is invalid or expired.', 401)
  if (officer.accountStatus !== 'ACTIVE' || !officer.isActive ||
      !officer.mustChangePassword || !officer.setupTokenHash ||
      !officer.setupTokenExpiresAt || officer.setupTokenExpiresAt <= now) {
    throw requestError('Password setup is unavailable for this registration.', 403)
  }

  const passwordHash = await bcrypt.hash(temporaryPassword, 10)
  const updated = await User.findOneAndUpdate(
    {
      _id: officer._id,
      role: normalizedRole,
      ...identifier,
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: true,
      registrationAccessTokenHash,
      registrationAccessTokenExpiresAt: { $gt: now },
      setupTokenHash: officer.setupTokenHash,
      setupTokenExpiresAt: { $gt: now },
    },
    {
      $set: { passwordHash, mustChangePassword: false },
      $unset: {
        setupTokenHash: 1,
        setupTokenExpiresAt: 1,
        registrationAccessTokenHash: 1,
        registrationAccessTokenExpiresAt: 1,
      },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw requestError('Password setup is unavailable for this registration.', 403)
  return serializeUser(updated)
}

export async function changeOfficerPassword({ actor, currentPassword, newPassword }) {
  if (!actor?.id || actor.role !== 'OFFICER') {
    throw requestError('An authenticated Officer is required.', 403)
  }
  if (typeof currentPassword !== 'string' || !currentPassword ||
      typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
    throw requestError('Enter the current password and choose a new password between 12 and 128 characters.', 400)
  }

  const officer = await User.findOne({
    _id: actor.id,
    role: 'OFFICER',
    accountStatus: 'ACTIVE',
    isActive: true,
    mustChangePassword: true,
  }).select('+passwordHash').lean()
  if (!officer?.passwordHash || !(await bcrypt.compare(currentPassword, officer.passwordHash))) {
    throw requestError('The current password is incorrect or this account does not require a password change.', 400)
  }
  if (currentPassword === newPassword) {
    throw requestError('Choose a new password different from the current password.', 400)
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  const updated = await User.findOneAndUpdate(
    {
      _id: officer._id,
      accountStatus: 'ACTIVE',
      mustChangePassword: true,
      passwordHash: officer.passwordHash,
    },
    {
      $set: { passwordHash, mustChangePassword: false },
      $unset: { setupTokenHash: 1, setupTokenExpiresAt: 1 },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw requestError('Officer password changed during this request; sign in again.', 409)
  return serializeUser(updated)
}

export async function listOfficerRegistrations(status = 'ALL') {
  const statuses = new Set(['ALL', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'])
  const normalizedStatus = String(status).toUpperCase()
  if (!statuses.has(normalizedStatus)) throw requestError('Invalid Officer registration status filter.', 400)

  const filter = { role: { $in: ['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'] } }
  if (normalizedStatus !== 'ALL') {
    filter.accountStatus = normalizedStatus
  }
  const registrations = await User.find(filter).sort({ createdAt: -1 }).lean()
  return registrations.map(serializeUser)
}

export async function getOfficerRegistration(userId) {
  if (!mongoose.isValidObjectId(userId)) return null
  const officer = await User.findOne({ _id: userId, role: { $in: ['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'] } }).lean()
  return officer ? serializeUser(officer) : null
}

export async function approveOfficerRegistration({ actor, userId }) {
  if (!actor?.id) throw requestError('An authenticated Admin is required.', 401)
  const officer = await User.findOne({
    _id: userId,
    role: { $in: ['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'] },
    accountStatus: 'PENDING',
  }).lean()
  if (!officer) throw requestError('Pending Officer registration not found.', 404)
  if (officer.role === 'OFFICER' || officer.role === 'GENERAL_OFFICER') {
    const department = await Department.findOne({ _id: officer.departmentId, isActive: true }).lean()
    const registryEntry = await GovernmentOfficerRegistry.findOne({
      governmentOfficerId: officer.governmentOfficerId,
      isActive: true,
      departmentId: officer.departmentId,
    }).lean()
    if (!registryEntry || !department) {
      throw requestError('The registered Government Officer identity or Department is no longer active.', 409)
    }
  }

  const token = randomBytes(32).toString('base64url')
  const setupTokenHash = hashSetupToken(token)
  const setupTokenExpiresAt = new Date(Date.now() + setupTokenLifetimeMs)
  const setupPath = officer.role === 'OFFICER'
    ? `/officer/setup?token=${encodeURIComponent(token)}&officerId=${encodeURIComponent(officer.governmentOfficerId)}`
    : officer.role === 'GENERAL_OFFICER'
      ? `/general-officer/setup?token=${encodeURIComponent(token)}&officerId=${encodeURIComponent(officer.governmentOfficerId)}`
      : `/human-verifier/setup?token=${encodeURIComponent(token)}`
  await sendOfficerSetupLink({
    email: officer.email,
    governmentOfficerId: officer.governmentOfficerId,
    role: officer.role,
    setupPath,
    expiresAt: setupTokenExpiresAt,
  })

  const updated = await User.findOneAndUpdate(
    { _id: officer._id, role: officer.role, accountStatus: 'PENDING' },
    {
      $set: {
        accountStatus: 'ACTIVE',
        isActive: true,
        permissions: ROLE_PERMISSIONS[officer.role],
        passwordHash: null,
        mustChangePassword: true,
        setupTokenHash,
        setupTokenExpiresAt,
        officerApprovedAt: new Date(),
        officerApprovedBy: actor.id,
      },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw requestError('Officer registration changed during approval; refresh and try again.', 409)

  await createAuditEvent({
    actor,
    action: `${officer.role}_REGISTRATION_APPROVED`,
    previousStatus: 'PENDING',
    newStatus: 'ACTIVE',
    reason: `Approved Officer registration ${officer.governmentOfficerId}.`,
  })

  return {
    success: true,
    message: officer.role === 'HUMAN_VERIFIER'
      ? 'Human Verifier registration approved successfully. The account can continue password setup.'
      : officer.role === 'GENERAL_OFFICER'
        ? 'General Officer registration approved successfully. The account can continue password setup.'
        : 'Officer registration approved successfully. The officer can open their Officer Dashboard to continue password setup.',
    user: serializeUser(updated),
    setupExpiresAt: setupTokenExpiresAt,
  }
}

export async function reissueOfficerPasswordSetup({ actor, userId }) {
  if (!actor?.id || actor.role !== 'ADMIN') {
    throw requestError('An authenticated Admin is required.', 401)
  }
  if (!mongoose.isValidObjectId(userId)) {
    throw requestError('Approved Officer account not found.', 404)
  }

  const officer = await User.findOne({
    _id: userId,
    role: { $in: ['OFFICER', 'GENERAL_OFFICER'] },
    accountStatus: 'ACTIVE',
    isActive: true,
    mustChangePassword: true,
  }).lean()
  if (!officer) {
    throw requestError('This staff account is not awaiting initial password setup.', 409)
  }
  const department = await Department.findOne({
    _id: officer.departmentId,
    isActive: true,
  }).lean()
  const registryEntry = await GovernmentOfficerRegistry.findOne({
    governmentOfficerId: officer.governmentOfficerId,
    departmentId: officer.departmentId,
    isActive: true,
  }).lean()
  if (!department || !registryEntry) {
    throw requestError('The Officer identity or Department is no longer active.', 409)
  }

  const setupToken = randomBytes(32).toString('base64url')
  const setupTokenHash = hashSetupToken(setupToken)
  const setupTokenExpiresAt = new Date(Date.now() + setupTokenLifetimeMs)
  const setupPath = officer.role === 'GENERAL_OFFICER'
    ? `/general-officer/setup?token=${encodeURIComponent(setupToken)}&officerId=${encodeURIComponent(officer.governmentOfficerId)}`
    : `/officer/setup?token=${encodeURIComponent(setupToken)}&officerId=${encodeURIComponent(officer.governmentOfficerId)}`
  const updated = await User.findOneAndUpdate(
    {
      _id: officer._id,
      role: officer.role,
      accountStatus: 'ACTIVE',
      isActive: true,
      mustChangePassword: true,
      departmentId: officer.departmentId,
    },
    {
      $set: { setupTokenHash, setupTokenExpiresAt },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) {
    throw requestError('Officer setup state changed; refresh the registration and try again.', 409)
  }

  const delivery = await sendOfficerSetupLink({
    email: officer.email,
    governmentOfficerId: officer.governmentOfficerId,
    role: officer.role,
    setupPath,
    expiresAt: setupTokenExpiresAt,
  })
  await createAuditEvent({
    actor,
    action: `${officer.role}_PASSWORD_SETUP_REISSUED`,
    reason: `Reissued initial password setup for approved ${officer.role === 'GENERAL_OFFICER' ? 'General Officer' : 'Officer'} ${officer.governmentOfficerId}.`,
  })

  return {
    message: `A new one-time password setup link has been issued to the ${officer.role === 'GENERAL_OFFICER' ? 'General Officer' : 'Officer'}.`,
    setupExpiresAt: setupTokenExpiresAt,
    ...(env.NODE_ENV === 'development' && delivery.setupPath
      ? { setupPath: delivery.setupPath }
      : {}),
  }
}

export async function rejectOfficerRegistration({ actor, userId, reason }) {
  if (!actor?.id) throw requestError('An authenticated Admin is required.', 401)
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) {
    throw requestError('A rejection reason of 1 to 2000 characters is required.', 400)
  }
  const currentRegistration = await User.findOne({
    _id: userId,
    role: { $in: ['OFFICER', 'HUMAN_VERIFIER', 'GENERAL_OFFICER'] },
    accountStatus: 'PENDING',
  }).select('_id role governmentOfficerId email').lean()
  if (!currentRegistration) throw requestError('Pending Officer registration not found.', 404)
  const officer = await User.findOneAndUpdate(
    { _id: userId, role: currentRegistration.role, accountStatus: 'PENDING' },
    {
      $set: {
        accountStatus: 'REJECTED',
        isActive: false,
        mustChangePassword: false,
        officerRejectedAt: new Date(),
        officerRejectedBy: actor.id,
        officerRejectionReason: reason.trim(),
      },
      $unset: { passwordHash: 1, setupTokenHash: 1, setupTokenExpiresAt: 1 },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!officer) throw requestError('Pending Officer registration not found.', 404)

  await createAuditEvent({
    actor,
    action: `${currentRegistration.role}_REGISTRATION_REJECTED`,
    previousStatus: 'PENDING',
    newStatus: 'REJECTED',
    reason: `Rejected Officer registration ${officer.governmentOfficerId}: ${reason.trim()}`,
  })
  return serializeUser(officer)
}

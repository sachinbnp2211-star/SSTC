import bcrypt from 'bcryptjs'
import { env } from '../config/env.mjs'
import User from '../models/User.mjs'

const adminPermissions = Object.freeze([
  'ORG_OVERVIEW',
  'APPLICATION_VIEW_ALL',
  'USER_MANAGE',
  'DEPARTMENT_MANAGE',
])

function validateConfiguration({ email, password, nodeEnv }) {
  if (nodeEnv !== 'development') {
    throw new Error('Admin seeding is available only when NODE_ENV is development.')
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('ADMIN_EMAIL must be a valid email address.')
  }
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters.')
  }
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

export async function ensureDevelopmentAdmin({
  email,
  password,
  nodeEnv = env.NODE_ENV,
  UserModel = User,
}) {
  validateConfiguration({ email, password, nodeEnv })
  const normalizedEmail = normalizeEmail(email)

  const adminUsers = await UserModel.find({ role: 'ADMIN' }).select('_id email displayName passwordHash').lean()
  const matchingAdmin = adminUsers.find((admin) => normalizeEmail(admin.email) === normalizedEmail) || adminUsers[0] || null
  const duplicateAdminIds = (matchingAdmin
    ? adminUsers
        .filter((admin) => String(admin._id) !== String(matchingAdmin._id))
        .map((admin) => admin._id)
    : adminUsers.map((admin) => admin._id)
  )

  if (matchingAdmin) {
    const existingUserWithConfiguredEmail = await UserModel.findOne({ email: normalizedEmail }).select('_id role').lean()
    if (existingUserWithConfiguredEmail && String(existingUserWithConfiguredEmail._id) !== String(matchingAdmin._id)) {
      throw new Error('ADMIN_EMAIL is already used by another account; refusing to change its role.')
    }

    const result = await UserModel.updateOne(
      { _id: matchingAdmin._id, role: 'ADMIN' },
      {
        $set: {
          email: normalizedEmail,
          role: 'ADMIN',
          displayName: matchingAdmin.displayName || 'Development Admin',
          permissions: [...adminPermissions],
          isActive: true,
          accountStatus: 'ACTIVE',
        },
      },
    )
    if (result.matchedCount !== 1) {
      throw new Error('The Admin account changed during reset; run the seed command again.')
    }

    if (duplicateAdminIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: duplicateAdminIds }, role: 'ADMIN' })
    }

    const finalAdmins = await UserModel.find({ role: 'ADMIN' }).select('_id').lean()
    return {
      created: false,
      adminsFound: adminUsers.length,
      canonicalAdminEmail: normalizedEmail,
      duplicateAdminsRemoved: duplicateAdminIds.length,
      finalAdminCount: finalAdmins.length,
    }
  }

  const existingUser = await UserModel.findOne({ email: normalizedEmail }).select('_id role').lean()
  if (existingUser) {
    throw new Error('ADMIN_EMAIL is already used by a non-Admin account; refusing to change its role.')
  }

  const createdUser = await UserModel.create({
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 10),
    displayName: 'Development Admin',
    role: 'ADMIN',
    departmentId: null,
    governmentOfficerId: null,
    permissions: [...adminPermissions],
    isActive: true,
    accountStatus: 'ACTIVE',
  })

  const finalAdmins = await UserModel.find({ role: 'ADMIN' }).select('_id').lean()
  return {
    created: true,
    adminsFound: 0,
    canonicalAdminEmail: normalizedEmail,
    duplicateAdminsRemoved: 0,
    finalAdminCount: finalAdmins.length,
    createdAdminId: createdUser?._id || null,
  }
}

export async function resetDevelopmentAdminPassword({
  email,
  password,
  nodeEnv = env.NODE_ENV,
  UserModel = User,
}) {
  validateConfiguration({ email, password, nodeEnv })
  const normalizedEmail = normalizeEmail(email)
  const adminUsers = await UserModel.find({ role: 'ADMIN' })
    .select('_id email')
    .lean()
  const matches = adminUsers.filter((admin) => normalizeEmail(admin.email) === normalizedEmail)

  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? 'The configured ADMIN_EMAIL does not match an existing Admin account; no password was changed.'
        : 'The configured ADMIN_EMAIL matches multiple Admin accounts; no password was changed.',
    )
  }

  const result = await UserModel.updateOne(
    { _id: matches[0]._id, role: 'ADMIN', email: normalizedEmail },
    { $set: { passwordHash: await bcrypt.hash(password, 10) } },
  )
  if (result.matchedCount !== 1) {
    throw new Error('The intended Admin account changed during reset; no password was changed.')
  }

  return {
    reset: true,
    adminId: String(matches[0]._id),
    adminEmail: normalizedEmail,
  }
}

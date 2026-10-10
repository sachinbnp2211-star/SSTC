import bcrypt from 'bcryptjs'
import User from '../models/User.mjs'
import RevokedToken from '../models/RevokedToken.mjs'
import { isDatabaseConnected } from '../config/database.mjs'

export const ROLE_PERMISSIONS = {
  APPLICANT: ['APPLICATION_CREATE'],
  OFFICER: ['APPLICATION_VIEW_ASSIGNED'],
  GENERAL_OFFICER: ['APPLICATION_VIEW_ASSIGNED', 'HUMAN_VERIFY_OCR'],
  HUMAN_VERIFIER: ['HUMAN_VERIFY_OCR'],
  ADMIN: ['ORG_OVERVIEW', 'APPLICATION_VIEW_ALL', 'USER_MANAGE', 'DEPARTMENT_MANAGE'],
}

export const STAFF_ROLES = Object.freeze(['OFFICER', 'GENERAL_OFFICER', 'HUMAN_VERIFIER'])

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function requireDatabase() {
  if (!isDatabaseConnected()) {
    const error = new Error('Authentication service is temporarily unavailable.')
    error.statusCode = 503
    throw error
  }
}

export function serializeUser(user) {
  if (!user) return null
  const safeUser = { ...user }
  delete safeUser.passwordHash
  delete safeUser.setupTokenHash
  delete safeUser.setupTokenExpiresAt
  delete safeUser.registrationAccessTokenHash
  delete safeUser.registrationAccessTokenExpiresAt
  if (safeUser._id && !safeUser.id) {
    safeUser.id = String(safeUser._id)
  }
  delete safeUser._id
  delete safeUser.__v
  return safeUser
}

export async function registerUser({
  email,
  password,
  displayName,
  role = 'APPLICANT',
  departmentId = null,
  governmentOfficerId = null,
  permissions = null,
  isActive = true,
  accountStatus = 'ACTIVE',
}) {
  requireDatabase()
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !password || !displayName) {
    const error = new Error('Email, password, and display name are required.')
    error.statusCode = 400
    throw error
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const error = new Error('Enter a valid email address.')
    error.statusCode = 400
    throw error
  }

  const normalizedRole = String(role || 'APPLICANT').trim().toUpperCase()
  if (!['APPLICANT', 'OFFICER', 'GENERAL_OFFICER', 'HUMAN_VERIFIER', 'ADMIN'].includes(normalizedRole)) {
    const error = new Error('Invalid role provided.')
    error.statusCode = 400
    throw error
  }

  const existingUser = await User.findOne({ email: normalizedEmail }).select('_id').lean()
  if (existingUser) {
    const error = new Error('An account with that email already exists.')
    error.statusCode = 409
    throw error
  }

  const finalPermissions = Array.isArray(permissions)
    ? permissions
    : ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.APPLICANT

  const passwordHash = await bcrypt.hash(password, 10)
  try {
    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      displayName: String(displayName).trim(),
      role: normalizedRole,
      departmentId: departmentId || null,
      governmentOfficerId: governmentOfficerId || null,
      permissions: finalPermissions,
      isActive,
      accountStatus,
    })
    return serializeUser(user.toObject())
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateError = new Error('An account with that email already exists.')
      duplicateError.statusCode = 409
      throw duplicateError
    }
    throw error
  }
}

export async function authenticateUser({ identifier, email, password }) {
  requireDatabase()
  const loginIdentifier = String(identifier ?? email ?? '').trim()
  if (!loginIdentifier || !password) {
    const error = new Error('Email or Government Officer ID and password are required.')
    error.statusCode = 400
    throw error
  }

  const normalizedEmail = normalizeEmail(loginIdentifier)
  const normalizedOfficerId = loginIdentifier.toUpperCase()
  const user = await User.findOne({
    $or: [{ email: normalizedEmail }, { governmentOfficerId: normalizedOfficerId }],
  }).select('+setupTokenHash +setupTokenExpiresAt').lean()
  if (!user) {
    const error = new Error('Invalid credentials.')
    error.statusCode = 401
    throw error
  }

  if (user.role === 'GENERAL_OFFICER' && normalizedOfficerId !== user.governmentOfficerId) {
    const error = new Error('Invalid credentials.')
    error.statusCode = 401
    throw error
  }

  if (user.role === 'OFFICER') {
    if (user.accountStatus === 'PENDING') {
      const error = new Error('Officer registration is awaiting Admin approval.')
      error.statusCode = 403
      throw error
    }
    if (user.accountStatus === 'REJECTED') {
      const error = new Error('Officer registration was rejected. Contact the HacKBios administrator.')
      error.statusCode = 403
      throw error
    }
    if (user.accountStatus === 'SUSPENDED' || !user.isActive) {
      const error = new Error('This Officer account is inactive.')
      error.statusCode = 403
      throw error
    }
  } else if (user.role === 'HUMAN_VERIFIER') {
    if (user.accountStatus === 'PENDING') {
      const error = new Error('Human Verifier registration is awaiting Admin approval.')
      error.statusCode = 403
      throw error
    }
    if (user.accountStatus === 'REJECTED') {
      const error = new Error('Human Verifier registration was rejected. Contact the administrator.')
      error.statusCode = 403
      throw error
    }
    if (user.accountStatus === 'SUSPENDED' || !user.isActive) {
      const error = new Error('Invalid credentials.')
      error.statusCode = 401
      throw error
    }
  } else if (user.role === 'GENERAL_OFFICER') {
    if (user.accountStatus === 'PENDING') {
      const error = new Error('General Officer registration is awaiting Admin approval.')
      error.statusCode = 403
      throw error
    }
    if (user.accountStatus === 'REJECTED') {
      const error = new Error('General Officer registration was rejected. Contact the administrator.')
      error.statusCode = 403
      throw error
    }
    if (user.accountStatus === 'SUSPENDED' || !user.isActive) {
      const error = new Error('This General Officer account is inactive.')
      error.statusCode = 403
      throw error
    }
  } else if (!user.isActive) {
    const error = new Error('Invalid credentials.')
    error.statusCode = 401
    throw error
  }

  if (!user.passwordHash) {
    const error = new Error('Officer password setup is required before login.')
    error.statusCode = 401
    throw error
  }
  const matches = await bcrypt.compare(String(password), user.passwordHash)
  if (!matches) {
    const error = new Error('Invalid credentials.')
    error.statusCode = 401
    throw error
  }

  return serializeUser(user)
}

export async function findUserById(id) {
  requireDatabase()
  const user = await User.findById(id).lean()
  return user ? serializeUser(user) : null
}

export async function revokeToken(tokenId, expiresAt) {
  requireDatabase()
  await RevokedToken.create({ tokenId, expiresAt })
}

export function hasPermission(user, permission) {
  if (!user) return false
  return Array.isArray(user.permissions) && user.permissions.includes(permission)
}

export function isRole(user, ...roles) {
  if (!user) return false
  return roles.includes(user.role)
}

export const ROLE_ORDER = Object.freeze(['APPLICANT', 'OFFICER', 'GENERAL_OFFICER', 'HUMAN_VERIFIER', 'ADMIN'])

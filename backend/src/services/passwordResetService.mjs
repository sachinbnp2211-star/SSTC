import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { env } from '../config/env.mjs'
import User from '../models/User.mjs'
import { normalizeEmail } from './authService.mjs'
import { sendPasswordResetLink } from './emailService.mjs'

const resetTokenLifetimeMs = 30 * 60 * 1000
const identifierPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const loginPaths = {
  APPLICANT: '/applicant/login',
  OFFICER: '/officer/login',
  GENERAL_OFFICER: '/general-officer/login',
  HUMAN_VERIFIER: '/human-verifier/login',
  ADMIN: '/admin/auth',
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function resetIdentifierFilter(identifier) {
  if (identifier.includes('@')) {
    if (!identifierPattern.test(identifier)) {
      throw requestError('Enter a valid email address or staff ID.', 400)
    }
    return { email: normalizeEmail(identifier) }
  }
  return { governmentOfficerId: identifier.toUpperCase() }
}

export async function requestPasswordReset(identifier) {
  const normalizedIdentifier = typeof identifier === 'string' ? identifier.trim() : ''
  if (!normalizedIdentifier || normalizedIdentifier.length > 254) {
    throw requestError('Enter your account email or staff ID.', 400)
  }

  const user = await User.findOne(resetIdentifierFilter(normalizedIdentifier))
    .select('+passwordResetTokenHash +passwordResetTokenExpiresAt')
    .lean()
  if (!user || !user.passwordHash || !user.isActive ||
      user.mustChangePassword ||
      ['PENDING', 'REJECTED', 'SUSPENDED'].includes(user.accountStatus)) {
    return { message: 'If an eligible account matches those details, a password reset link will be sent.' }
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + resetTokenLifetimeMs)
  const resetPath = `/password/reset?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(loginPaths[user.role] || loginPaths.APPLICANT)}`

  const resetHash = tokenHash(token)
  const updated = await User.updateOne(
    { _id: user._id, isActive: true, passwordHash: user.passwordHash },
    {
      $set: {
        passwordResetTokenHash: resetHash,
        passwordResetTokenExpiresAt: expiresAt,
      },
    },
  )
  if (updated.modifiedCount !== 1) {
    throw requestError('Account state changed; request a new password reset link.', 409)
  }
  try {
    await sendPasswordResetLink({
      email: user.email,
      role: user.role,
      resetPath,
      expiresAt,
    })
  } catch (error) {
    await User.updateOne(
      { _id: user._id, passwordResetTokenHash: resetHash },
      { $unset: { passwordResetTokenHash: 1, passwordResetTokenExpiresAt: 1 } },
    )
    if (error.statusCode) throw error
    throw requestError('Password reset email could not be sent. Please try again later.', 503)
  }

  return {
    message: 'If an eligible account matches those details, a password reset link will be sent.',
    ...(env.NODE_ENV === 'development' ? { resetPath } : {}),
  }
}

export async function resetPassword({ token, newPassword }) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
    throw requestError('This password reset link is invalid or expired. Request a new one.', 400)
  }
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
    throw requestError('Choose a password between 12 and 128 characters.', 400)
  }

  const now = new Date()
  const suppliedTokenHash = tokenHash(token)
  const user = await User.findOne({
    passwordResetTokenHash: suppliedTokenHash,
    passwordResetTokenExpiresAt: { $gt: now },
    isActive: true,
  }).select('+passwordResetTokenHash +passwordResetTokenExpiresAt').lean()
  if (!user || user.mustChangePassword ||
      ['PENDING', 'REJECTED', 'SUSPENDED'].includes(user.accountStatus)) {
    throw requestError('This password reset link is invalid or expired. Request a new one.', 400)
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  const updated = await User.updateOne(
    {
      _id: user._id,
      passwordResetTokenHash: suppliedTokenHash,
      passwordResetTokenExpiresAt: { $gt: now },
      isActive: true,
    },
    {
      $set: { passwordHash, mustChangePassword: false },
      $unset: { passwordResetTokenHash: 1, passwordResetTokenExpiresAt: 1 },
    },
  )
  if (updated.modifiedCount !== 1) {
    throw requestError('This password reset link is invalid or expired. Request a new one.', 400)
  }
  return { message: 'Your password has been reset. You can now sign in.' }
}

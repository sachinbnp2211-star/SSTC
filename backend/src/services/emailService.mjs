import { randomBytes } from 'node:crypto'
import { env } from '../config/env.mjs'

const developmentPreviewLifetimeMs = 24 * 60 * 60 * 1000
const developmentEmailPreviews = new Map()
let officerEmailSender = null

export function configureOfficerEmailSender(sender) {
  if (sender !== null && typeof sender !== 'function') {
    throw new TypeError('Officer email sender must be a function or null.')
  }
  officerEmailSender = sender
}

function removeExpiredDevelopmentPreviews(now = Date.now()) {
  for (const [previewId, preview] of developmentEmailPreviews) {
    if (preview.expiresAt.getTime() <= now) developmentEmailPreviews.delete(previewId)
  }
}

export async function sendOfficerSetupLink({
  email,
  governmentOfficerId,
  role = 'OFFICER',
  setupPath,
  expiresAt,
}) {
  const accountLabel = role === 'HUMAN_VERIFIER'
    ? 'Human Verifier'
    : role === 'GENERAL_OFFICER'
      ? 'General Officer'
      : 'Officer'
  const message = {
    to: email,
    subject: `Set up your HacKBios ${accountLabel} password`,
    text: `Use this one-time link to set up your HacKBios ${accountLabel} password: ${setupPath}`,
    metadata: {
      type: `${role}_PASSWORD_SETUP`,
      governmentOfficerId,
      expiresAt: expiresAt.toISOString(),
    },
    setupPath,
  }

  if (officerEmailSender) {
    await officerEmailSender(message)
  } else if (env.NODE_ENV !== 'development') {
    const error = new Error('Officer setup email delivery is not configured.')
    error.statusCode = 503
    throw error
  }

  if (env.NODE_ENV !== 'development') return { delivered: true }

  removeExpiredDevelopmentPreviews()
  const developmentPreviewId = randomBytes(24).toString('base64url')
  developmentEmailPreviews.set(developmentPreviewId, {
    to: message.to,
    subject: message.subject,
    metadata: message.metadata,
    setupPath: message.setupPath,
    expiresAt: new Date(Date.now() + developmentPreviewLifetimeMs),
  })
  return { delivered: true, developmentPreviewId, setupPath: message.setupPath }
}

export async function sendPasswordResetLink({ email, role, resetPath, expiresAt }) {
  const accountLabel = role === 'APPLICANT'
    ? 'Applicant'
    : role === 'GENERAL_OFFICER'
      ? 'General Officer'
      : role === 'HUMAN_VERIFIER'
        ? 'Human Verifier'
        : role === 'ADMIN'
          ? 'Admin'
          : 'Officer'
  const message = {
    to: email,
    subject: `Reset your HacKBios ${accountLabel} password`,
    text: `Use this one-time link to reset your HacKBios ${accountLabel} password: ${resetPath}`,
    metadata: {
      type: 'PASSWORD_RESET',
      role,
      expiresAt: expiresAt.toISOString(),
    },
    resetPath,
  }

  if (officerEmailSender) {
    await officerEmailSender(message)
  } else if (env.NODE_ENV !== 'development') {
    const error = new Error('Password reset email delivery is not configured.')
    error.statusCode = 503
    throw error
  }

  if (env.NODE_ENV !== 'development') return { delivered: true }

  return { delivered: true, resetPath: message.resetPath }
}

export function getDevelopmentOfficerEmailPreview(previewId) {
  if (env.NODE_ENV !== 'development') return null
  removeExpiredDevelopmentPreviews()
  if (typeof previewId !== 'string') return null
  return developmentEmailPreviews.get(previewId) || null
}

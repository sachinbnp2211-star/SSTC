import { Router } from 'express'

import {
  authenticateUser,
  registerUser,
  revokeToken,
} from '../services/authService.mjs'
import {
  changeOfficerPassword,
  completeOfficerPasswordSetup,
  registerHumanVerifier,
  registerOfficer,
  validateOfficerRegistration,
} from '../services/officerRegistrationService.mjs'
import { requestPasswordReset, resetPassword } from '../services/passwordResetService.mjs'

import { requireAuth, signToken } from '../middleware/auth.mjs'

const router = Router()

function sendAuthError(res, error, fallbackMessage) {
  const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
  const status = error.statusCode || (isDatabaseError ? 503 : 500)
  const message = status >= 500 ? fallbackMessage : error.message
  return res.status(status).json({ error: message })
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body || {}

    const user = await registerUser({
      email,
      password,
      displayName,
      role: 'APPLICANT',
    })

    const token = signToken(user)

    return res.status(201).json({ token, user })
  } catch (error) {
    return sendAuthError(res, error, 'Registration is temporarily unavailable.')
  }
})

router.post('/officer-registration', async (req, res) => {
  if (req.headers.authorization) {
    return res.status(403).json({
      error: 'Officer self-registration must be submitted without an existing user session.',
    })
  }
  try {
    let result
    if (req.body?.role === 'HUMAN_VERIFIER') {
      result = await registerHumanVerifier({
        email: req.body?.email,
        displayName: req.body?.displayName,
      })
    } else if (req.body?.role === 'GENERAL_OFFICER') {
      result = await registerOfficer({
        governmentOfficerId: req.body?.governmentOfficerId,
        displayName: req.body?.displayName,
        email: req.body?.email,
        role: 'GENERAL_OFFICER',
      })
    } else if (req.body?.role === undefined || req.body?.role === 'OFFICER') {
      result = await registerOfficer({
        governmentOfficerId: req.body?.governmentOfficerId,
        role: req.body?.role,
        displayName: req.body?.displayName,
        email: req.body?.email,
      })
    } else {
      return res.status(400).json({ error: 'Choose a supported registration type.' })
    }
    return res.status(201).json({
      user: result.user,
      department: result.department,
      status: result.status || 'PENDING',
      reRegistered: result.reRegistered,
      registrationAccessToken: result.registrationAccessToken,
      registrationAccessExpiresAt: result.registrationAccessExpiresAt,
    })
  } catch (error) {
    return sendAuthError(res, error, 'Officer registration is temporarily unavailable.')
  }
})

router.post('/officer-registration/validate', async (req, res) => {
  if (req.headers.authorization) {
    return res.status(403).json({
      error: 'Officer registration validation must be submitted without an existing user session.',
    })
  }
  try {
    const result = await validateOfficerRegistration({
      governmentOfficerId: req.body?.governmentOfficerId,
      role: req.body?.role,
      displayName: req.body?.displayName,
      email: req.body?.email,
    })
    return res.json(result)
  } catch (error) {
    return sendAuthError(res, error, 'Officer identity validation is temporarily unavailable.')
  }
})

router.post('/officer-setup', async (req, res) => {
  try {
    const user = await completeOfficerPasswordSetup({
      setupToken: req.body?.setupToken,
      temporaryPassword: req.body?.temporaryPassword,
      role: req.body?.role,
    })
    return res.json({ user })
  } catch (error) {
    return sendAuthError(res, error, 'Officer password setup is temporarily unavailable.')
  }
})

router.post('/login', async (req, res) => {
  try {
    const { email, identifier, password } = req.body || {}

    const user = await authenticateUser({ identifier, email, password })

    const token = signToken(user)

    return res.json({ token, user })
  } catch (error) {
    return sendAuthError(res, error, 'Login is temporarily unavailable.')
  }
})

router.post('/password-reset/request', async (req, res) => {
  try {
    const result = await requestPasswordReset(req.body?.identifier)
    return res.json(result)
  } catch (error) {
    return sendAuthError(res, error, 'Password reset is temporarily unavailable.')
  }
})

router.post('/password-reset/complete', async (req, res) => {
  try {
    const result = await resetPassword({
      token: req.body?.token,
      newPassword: req.body?.newPassword,
    })
    return res.json(result)
  } catch (error) {
    return sendAuthError(res, error, 'Password reset is temporarily unavailable.')
  }
})

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const user = await changeOfficerPassword({
      actor: req.user,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    })
    await revokeToken(req.authTokenId, req.authTokenExpiresAt)
    const token = signToken(user)
    return res.json({ token, user })
  } catch (error) {
    return sendAuthError(res, error, 'Password change is temporarily unavailable.')
  }
})

router.get('/me', requireAuth, (req, res) => {
  const user = { ...req.user }

  delete user.passwordHash

  return res.json({ user })
})

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await revokeToken(req.authTokenId, req.authTokenExpiresAt)
    return res.json({ ok: true })
  } catch (error) {
    return sendAuthError(res, error, 'Logout is temporarily unavailable.')
  }
})

export default router
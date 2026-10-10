import { Router } from 'express'
import {
  requireAuth,
  requireOfficerPasswordChanged,
  requirePermission,
  requireRole,
} from '../middleware/auth.mjs'
import {
  decideOfficerReview,
  getOfficerApplication,
  listOfficerApplications,
  startOfficerReview,
} from '../services/officerReviewService.mjs'
import {
  completeOfficerRegistrationPasswordSetup,
  getOfficerRegistrationStatus,
} from '../services/officerRegistrationService.mjs'

const router = Router()

function sendOfficerError(res, error) {
  const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
  const status = error.statusCode || (isDatabaseError ? 503 : 500)
  return res.status(status).json({
    error: status >= 500
      ? 'Officer review service is temporarily unavailable.'
      : error.message,
  })
}

function getRegistrationAccessToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

router.post('/registration/status', async (req, res) => {
  try {
    const status = await getOfficerRegistrationStatus({
      role: req.body?.role,
      governmentOfficerId: req.body?.governmentOfficerId,
      email: req.body?.email,
      registrationAccessToken: getRegistrationAccessToken(req),
    })
    return res.json(status)
  } catch (error) {
    return sendOfficerError(res, error)
  }
})

router.post('/registration/setup', async (req, res) => {
  try {
    const user = await completeOfficerRegistrationPasswordSetup({
      role: req.body?.role,
      governmentOfficerId: req.body?.governmentOfficerId,
      email: req.body?.email,
      registrationAccessToken: getRegistrationAccessToken(req),
      temporaryPassword: req.body?.temporaryPassword,
    })
    return res.json({ user })
  } catch (error) {
    return sendOfficerError(res, error)
  }
})

router.use(
  requireAuth,
  requireRole('OFFICER'),
  requireOfficerPasswordChanged,
  requirePermission('APPLICATION_VIEW_ASSIGNED'),
)

router.get('/applications', async (req, res) => {
  try {
    const applications = await listOfficerApplications(req.user)
    return res.json({ applications })
  } catch (error) {
    return sendOfficerError(res, error)
  }
})

router.get('/applications/:applicationId', async (req, res) => {
  try {
    const application = await getOfficerApplication(req.user, req.params.applicationId)
    if (!application) return res.status(404).json({ error: 'Application not found in your Department review scope.' })
    return res.json({ application })
  } catch (error) {
    return sendOfficerError(res, error)
  }
})

router.post('/applications/:applicationId/start-review', async (req, res) => {
  try {
    const application = await startOfficerReview(req.user, req.params.applicationId)
    if (!application) return res.status(404).json({ error: 'Application is not assigned in your Department review scope.' })
    return res.json({ application })
  } catch (error) {
    return sendOfficerError(res, error)
  }
})

router.post('/applications/:applicationId/decision', async (req, res) => {
  try {
    const application = await decideOfficerReview({
      officer: req.user,
      applicationId: req.params.applicationId,
      decision: req.body?.decision,
      reason: req.body?.reason,
    })
    if (!application) return res.status(404).json({ error: 'Application is not under review in your Department scope.' })
    return res.json({ application })
  } catch (error) {
    return sendOfficerError(res, error)
  }
})

export default router

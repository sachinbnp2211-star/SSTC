import { Router } from 'express'
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.mjs'
import {
  decideHumanVerification,
  decideHumanVerificationApplication,
  getHumanVerificationApplication,
  listHumanVerificationApplications,
  listHumanVerificationDepartments,
  getPendingHumanVerification,
  listPendingHumanVerifications,
  startHumanVerificationApplicationReview,
  startHumanVerificationReview,
} from '../services/humanVerificationService.mjs'

const router = Router()
const requireHumanVerifier = [
  requireAuth,
  requireRole('HUMAN_VERIFIER', 'GENERAL_OFFICER'),
  requirePermission('HUMAN_VERIFY_OCR'),
]
const requireHumanVerifierRole = [
  requireAuth,
  requireRole('HUMAN_VERIFIER'),
  requirePermission('HUMAN_VERIFY_OCR'),
]

function sendVerificationError(res, error) {
  const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
  const status = error.statusCode || (isDatabaseError ? 503 : 500)
  return res.status(status).json({
    error: status >= 500
      ? 'Human verification service is temporarily unavailable.'
      : error.message,
  })
}

router.get('/applications', ...requireHumanVerifierRole, async (req, res) => {
  try {
    const queue = await listHumanVerificationApplications(req.query.status || 'PENDING')
    return res.json({ queue })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.get('/departments', ...requireHumanVerifierRole, async (_req, res) => {
  try {
    const departments = await listHumanVerificationDepartments()
    return res.json({ departments })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.get('/applications/:applicationId', ...requireHumanVerifierRole, async (req, res) => {
  try {
    const application = await getHumanVerificationApplication(req.params.applicationId)
    if (!application) return res.status(404).json({ error: 'Application not found in the Human Verification queue.' })
    return res.json({ application })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.post('/applications/:applicationId/start-review', ...requireHumanVerifierRole, async (req, res) => {
  try {
    const result = await startHumanVerificationApplicationReview({
      applicationId: req.params.applicationId,
      actor: req.user,
    })
    if (!result) return res.status(404).json({ error: 'Application not found in the Human Verification queue.' })
    return res.json({ result })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.post('/applications/:applicationId/decision', ...requireHumanVerifierRole, async (req, res) => {
  try {
    const result = await decideHumanVerificationApplication({
      applicationId: req.params.applicationId,
      actor: req.user,
      decision: req.body?.decision,
      departmentId: req.body?.departmentId,
      reason: req.body?.reason,
    })
    if (!result) return res.status(404).json({ error: 'Application not found in the Human Verification queue.' })
    return res.json({ result })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.get('/', ...requireHumanVerifier, async (req, res) => {
  try {
    const queue = await listPendingHumanVerifications(req.query.status || 'PENDING')
    return res.json({ queue })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.post('/:documentId/start-review', ...requireHumanVerifier, async (req, res) => {
  try {
    const result = await startHumanVerificationReview({
      documentId: req.params.documentId,
      actor: req.user,
    })
    if (!result) return res.status(404).json({ error: 'Document not found in the human verification queue.' })
    return res.json({ result })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.get('/:documentId', ...requireHumanVerifier, async (req, res) => {
  try {
    const review = await getPendingHumanVerification(req.params.documentId)
    if (!review) return res.status(404).json({ error: 'Document not found in the pending verification queue.' })
    return res.json({ review })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

router.post('/:documentId/decision', ...requireHumanVerifier, async (req, res) => {
  try {
    const result = await decideHumanVerification({
      documentId: req.params.documentId,
      actor: req.user,
      decision: req.body?.decision,
      correctedFields: req.body?.correctedFields,
      note: req.body?.note,
    })
    if (!result) return res.status(404).json({ error: 'Document not found in the pending verification queue.' })
    return res.json({ result })
  } catch (error) {
    return sendVerificationError(res, error)
  }
})

export default router

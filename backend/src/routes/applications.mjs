import { Router } from 'express'
import multer from 'multer'
import { env } from '../config/env.mjs'
import { requireAuth, requireRole } from '../middleware/auth.mjs'
import { createApplicantDocument } from '../services/documentService.mjs'
import {
  createApplicantApplication,
  getApplicantApplication,
  listApplicantApplications,
  submitApplicantApplication,
} from '../services/applicationService.mjs'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_SIZE_BYTES, files: 1 },
})

function sendApplicationError(res, error) {
  const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
  const status = error.statusCode || (isDatabaseError ? 503 : 500)
  const message = status >= 500
    ? 'Application service is temporarily unavailable.'
    : error.message
  return res.status(status).json({ error: message })
}

router.use(requireAuth, requireRole('APPLICANT'))

router.post('/:applicationId/documents', (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      return res.status(status).json({
        error: status === 413 ? 'The document exceeds the maximum upload size.' : 'A valid single document file is required.',
      })
    }
    return next()
  })
}, async (req, res) => {
  try {
    const document = await createApplicantDocument({
      actor: req.user,
      applicationId: req.params.applicationId,
      file: req.file,
    })
    if (!document) return res.status(404).json({ error: 'Application not found.' })
    return res.status(201).json({ document })
  } catch (error) {
    return sendApplicationError(res, error)
  }
})

router.get('/', async (req, res) => {
  try {
    const applications = await listApplicantApplications(req.user.id)
    return res.json({ applications })
  } catch (error) {
    return sendApplicationError(res, error)
  }
})

router.get('/:id', async (req, res) => {
  try {
    const application = await getApplicantApplication(req.user.id, req.params.id)
    if (!application) return res.status(404).json({ error: 'Application not found.' })
    return res.json({ application })
  } catch (error) {
    return sendApplicationError(res, error)
  }
})

router.post('/', async (req, res) => {
  try {
    const application = await createApplicantApplication(req.user, req.body)
    return res.status(201).json({ application })
  } catch (error) {
    return sendApplicationError(res, error)
  }
})

router.post('/:id/submit', async (req, res) => {
  try {
    const application = await submitApplicantApplication(req.user, req.params.id)
    if (!application) return res.status(404).json({ error: 'Application not found.' })
    return res.json({ application })
  } catch (error) {
    return sendApplicationError(res, error)
  }
})

export default router

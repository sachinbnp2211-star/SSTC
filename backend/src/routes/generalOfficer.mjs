import { Router } from 'express'
import multer from 'multer'
import { parse as parsePath } from 'node:path'
import { env } from '../config/env.mjs'
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.mjs'
import Application from '../models/Application.mjs'
import Document from '../models/Document.mjs'
import { createApplicantDocument } from '../services/documentService.mjs'
import {
  createApplicantApplication,
  getApplicantApplication,
  submitApplicantApplication,
} from '../services/applicationService.mjs'
import { readExtractedText } from '../services/documentStorage.mjs'
import {
  decideEscalatedApplication,
  getEscalatedApplication,
  listGeneralOfficerDashboardApplications,
  listEscalatedApplications,
} from '../services/generalOfficerReviewService.mjs'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_SIZE_BYTES, files: 1 },
})
router.use(requireAuth, requireRole('GENERAL_OFFICER'), requirePermission('APPLICATION_VIEW_ASSIGNED'))

function sendReviewError(res, error) {
  const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
  const status = error.statusCode || (isDatabaseError ? 503 : 500)
  return res.status(status).json({
    error: status >= 500
      ? 'General Officer review service is temporarily unavailable.'
      : error.message,
  })
}

function uploadedDocumentLabel(file) {
  return parsePath(file.originalname).name
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Uploaded document'
}

function extractApplicantName(text) {
  const match = text.match(/^\s*(?:applicant(?:\s+name)?|name\s+of\s+applicant)\s*[:=-]\s*(.+?)\s*$/im)
  return match?.[1].trim().replace(/\s+/g, ' ').slice(0, 160) || null
}

router.get('/applications', async (_req, res) => {
  try {
    const applications = await listEscalatedApplications()
    return res.json({ applications })
  } catch (error) {
    return sendReviewError(res, error)
  }
})

router.get('/dashboard', async (req, res) => {
  try {
    const dashboard = await listGeneralOfficerDashboardApplications(
      req.user.id,
      req.query?.search === undefined ? '' : req.query.search,
    )
    return res.json(dashboard)
  } catch (error) {
    return sendReviewError(res, error)
  }
})

router.post('/submissions', (req, res, next) => {
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
  let application
  try {
    if (!req.file) return res.status(400).json({ error: 'A document file is required.' })
    const documentLabel = uploadedDocumentLabel(req.file)
    application = await createApplicantApplication(req.user, {
      applicationType: req.body?.applicationType || documentLabel,
      title: req.body?.title || documentLabel,
      applicantName: req.body?.applicantName || 'Not identified in document',
      contactEmail: req.body?.contactEmail || req.user.email,
      details: req.body?.details || 'Submitted by a General Officer from the uploaded document.',
    })
    try {
      await createApplicantDocument({
        actor: req.user,
        applicationId: application.id,
        file: req.file,
      })
    } catch (error) {
      if (error.statusCode !== 422) throw error
      console.info('[GENERAL_OFFICE_SUBMISSION]', JSON.stringify({
        applicationId: application.id,
        ocrUploadFailed: true,
      }))
    }
    const submitted = await submitApplicantApplication(req.user, application.id)
    if (!submitted) return res.status(404).json({ error: 'Application could not be found after submission.' })
    const storedDocument = await Document.findOne({ applicationId: submitted.id })
      .select('classification.documentType +extractedTextStorageId')
      .lean()
    let applicantName = req.body?.applicantName?.trim() || null
    if (!applicantName && storedDocument?.extractedTextStorageId) {
      applicantName = extractApplicantName(await readExtractedText(storedDocument.extractedTextStorageId))
    }
    const persistedValues = {
      applicationType: storedDocument?.classification?.documentType?.trim() || submitted.applicationType,
      ...(applicantName ? { 'applicationData.applicantName': applicantName } : {}),
    }
    if (storedDocument?.classification?.documentType?.trim()) {
      persistedValues['applicationData.title'] = storedDocument.classification.documentType.trim()
    }
    await Application.updateOne(
      { _id: submitted.id, applicantId: req.user.id },
      { $set: persistedValues },
    )
    const persistedApplication = await getApplicantApplication(req.user.id, submitted.id)
    if (!persistedApplication) return res.status(404).json({ error: 'Submitted application could not be retrieved.' })
    return res.status(201).json({
      application: persistedApplication,
      receipt: {
        applicationType: persistedApplication.applicationType,
        applicationId: persistedApplication.id,
        applicantName: persistedApplication.applicantName,
      },
    })
  } catch (error) {
    return sendReviewError(res, error)
  }
})

router.get('/submissions/:applicationId', async (req, res) => {
  try {
    const application = await getApplicantApplication(req.user.id, req.params.applicationId)
    if (!application) return res.status(404).json({ error: 'Submission not found.' })
    return res.json({ application })
  } catch (error) {
    return sendReviewError(res, error)
  }
})

router.get('/applications/:applicationId', async (req, res) => {
  try {
    const application = await getEscalatedApplication(req.params.applicationId)
    if (!application) return res.status(404).json({ error: 'Application not found in the escalated queue.' })
    return res.json({ application })
  } catch (error) {
    return sendReviewError(res, error)
  }
})

router.post('/applications/:applicationId/decision', async (req, res) => {
  try {
    const application = await decideEscalatedApplication({
      generalOfficer: req.user,
      applicationId: req.params.applicationId,
      decision: req.body?.decision,
      reason: req.body?.reason,
    })
    if (!application) return res.status(404).json({ error: 'Application is no longer in the escalated queue.' })
    return res.json({ application })
  } catch (error) {
    return sendReviewError(res, error)
  }
})

export default router

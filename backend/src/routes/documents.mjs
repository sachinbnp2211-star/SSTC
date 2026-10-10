import { Router } from 'express'
import { requireAuth, requireOfficerPasswordChanged } from '../middleware/auth.mjs'
import {
  getApplicantDocument,
  getGeneralOfficerOriginalDocument,
  getOfficerOriginalDocument,
  getPendingVerificationDocument,
} from '../services/documentService.mjs'

const router = Router()

router.get('/:documentId', requireAuth, requireOfficerPasswordChanged, async (req, res) => {
  try {
    let result
    if (req.user.role === 'APPLICANT') {
      result = await getApplicantDocument(req.user.id, req.params.documentId)
    } else if (
      (req.user.role === 'HUMAN_VERIFIER' || req.user.role === 'GENERAL_OFFICER') &&
      req.user.permissions?.includes('HUMAN_VERIFY_OCR')
    ) {
      result = await getPendingVerificationDocument(req.params.documentId)
      if (!result && req.user.role === 'GENERAL_OFFICER') {
        result = await getGeneralOfficerOriginalDocument(req.user.id, req.params.documentId)
      }
    } else if (
      req.user.role === 'OFFICER' &&
      req.user.permissions?.includes('APPLICATION_VIEW_ASSIGNED')
    ) {
      result = await getOfficerOriginalDocument(
        req.user.id,
        req.user.departmentId,
        req.params.documentId,
      )
    } else if (
      req.user.role === 'GENERAL_OFFICER' &&
      req.user.permissions?.includes('APPLICATION_VIEW_ASSIGNED')
    ) {
      result = await getGeneralOfficerOriginalDocument(req.user.id, req.params.documentId)
      if (!result) {
        return res.status(403).json({ error: 'This document is not available to the General Officer.' })
      }
    } else {
      return res.status(403).json({ error: 'This action is not permitted for the current role.' })
    }
    if (!result) return res.status(404).json({ error: 'Document not found.' })

    const safeFilename = encodeURIComponent(result.document.name).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    return res
      .status(200)
      .set({
        'Content-Type': result.document.mimeType,
        'Content-Length': String(result.content.length),
        'Content-Disposition': `inline; filename*=UTF-8''${safeFilename}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(result.content)
  } catch (error) {
    const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
    const status = isDatabaseError ? 503 : 500
    return res.status(status).json({
      error: status === 503 ? 'Document service is temporarily unavailable.' : 'The document could not be retrieved.',
    })
  }
})

export default router

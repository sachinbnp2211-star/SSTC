import { Router } from 'express'
import mongoose from 'mongoose'
import Application from '../models/Application.mjs'
import { isDatabaseConnected } from '../config/database.mjs'

const router = Router()
const applicationIdPattern = /^[a-f\d]{24}$/i
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

router.post('/lookup', async (req, res) => {
  const identifier = typeof req.body?.identifier === 'string'
    ? req.body.identifier.trim()
    : ''
  if (!identifier || identifier.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address or Application ID.' })
  }
  if (!isDatabaseConnected()) {
    return res.status(503).json({ error: 'Application status service is temporarily unavailable.' })
  }

  try {
    let applications
    if (applicationIdPattern.test(identifier)) {
      applications = await Application.find({ _id: new mongoose.Types.ObjectId(identifier) })
        .select('_id applicationType status submittedAt updatedAt')
        .lean()
    } else if (emailPattern.test(identifier)) {
      applications = await Application.find({
        'applicationData.contactEmail': identifier.toLowerCase(),
      })
        .select('_id applicationType status submittedAt updatedAt')
        .sort({ updatedAt: -1, _id: -1 })
        .limit(20)
        .lean()
    } else {
      return res.status(400).json({ error: 'Enter a valid email address or Application ID.' })
    }

    return res.json({
      applications: applications.map((application) => ({
        id: String(application._id),
        applicationType: application.applicationType,
        status: application.status,
        submittedAt: application.submittedAt,
        updatedAt: application.updatedAt,
      })),
    })
  } catch (error) {
    const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
    return res.status(isDatabaseError ? 503 : 500).json({
      error: 'Application status service is temporarily unavailable.',
    })
  }
})

export default router

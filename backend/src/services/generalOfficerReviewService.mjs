import mongoose from 'mongoose'
import Application from '../models/Application.mjs'
import Document from '../models/Document.mjs'
import User from '../models/User.mjs'
import { listApplicantApplications } from './applicationService.mjs'
import { readExtractedText } from './documentStorage.mjs'
import { recordApplicationStatusTransition } from './applicationLifecycleService.mjs'
import { getReviewDocuments, serializeOfficerApplication } from './officerReviewService.mjs'

const decisions = new Set(['APPROVED', 'REJECTED'])

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

async function serializeGeneralOfficerApplication(application, { includeDocuments = false } = {}) {
  const documents = includeDocuments ? await getReviewDocuments(application._id) : []
  const result = await serializeOfficerApplication(application, documents)
  const generalReview = application.generalOfficerReview || {}
  const notes = generalReview.notes || []
  const reviewerIds = [...new Set(notes.map((note) => String(note.generalOfficerId)))]
  const reviewers = reviewerIds.length
    ? await User.find({ _id: { $in: reviewerIds } })
      .select('_id displayName governmentOfficerId')
      .lean()
    : []
  const reviewerNames = new Map(reviewers.map((reviewer) => [
    String(reviewer._id),
    reviewer.displayName || reviewer.governmentOfficerId || 'General Officer',
  ]))

  result.timeline.push(...notes.map((note, index) => ({
    id: `${application._id}-general-officer-review-${index + 1}`,
    label: `General Officer ${note.action.toLowerCase()}`,
    detail: note.reason || undefined,
    at: note.at,
  })))
  result.generalOfficerReview = {
    decision: generalReview.decision || null,
    decidedBy: generalReview.decidedBy ? String(generalReview.decidedBy) : null,
    decidedAt: generalReview.decidedAt || null,
    reason: generalReview.reason || null,
    notes: notes.map((note) => ({
      generalOfficerId: String(note.generalOfficerId),
      generalOfficerName: reviewerNames.get(String(note.generalOfficerId)) || 'General Officer',
      action: note.action,
      reason: note.reason || null,
      at: note.at,
    })),
  }
  return result
}

export async function listEscalatedApplications() {
  const applications = await Application.find({ status: 'ESCALATED' })
    .sort({ updatedAt: -1, _id: -1 })
    .lean()
  return Promise.all(applications.map((application) => serializeGeneralOfficerApplication(application)))
}

async function filterApplicationsBySearch(applications, search) {
  const query = typeof search === 'string' ? search.trim().toLocaleLowerCase() : ''
  if (!query) return applications
  if (query.length > 160) throw requestError('Search text must be 160 characters or fewer.', 400)

  const metadataMatches = new Set(
    applications
      .filter((application) => [
        application.id,
        application.applicationType,
        application.title,
        application.applicantName,
      ].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      .map(({ id }) => id),
  )
  const remainingIds = applications
    .map(({ id }) => id)
    .filter((id) => !metadataMatches.has(id))
  if (!remainingIds.length) {
    return applications.filter(({ id }) => metadataMatches.has(id))
  }

  const documents = await Document.find({
    applicationId: { $in: remainingIds },
    extractedTextStorageId: { $type: 'string' },
  }).select('+extractedTextStorageId applicationId').lean()
  const ocrMatches = new Set()
  for (const document of documents) {
    const extractedText = await readExtractedText(document.extractedTextStorageId)
    if (extractedText.toLocaleLowerCase().includes(query)) {
      ocrMatches.add(String(document.applicationId))
    }
  }
  return applications.filter(({ id }) => metadataMatches.has(id) || ocrMatches.has(id))
}

export async function listGeneralOfficerDashboardApplications(generalOfficerId, search = '') {
  if (!mongoose.isValidObjectId(generalOfficerId)) {
    throw requestError('Authenticated General Officer identity is invalid.', 401)
  }
  if (typeof search !== 'string') {
    throw requestError('Search text must be a string.', 400)
  }
  const submissions = await listApplicantApplications(generalOfficerId)
  return {
    submissions: await filterApplicationsBySearch(submissions, search),
  }
}

export async function getEscalatedApplication(applicationId) {
  if (!mongoose.isValidObjectId(applicationId)) return null
  const application = await Application.findOne({ _id: applicationId, status: 'ESCALATED' }).lean()
  if (!application) return null
  return serializeGeneralOfficerApplication(application, { includeDocuments: true })
}

export async function decideEscalatedApplication({
  generalOfficer,
  applicationId,
  decision,
  reason,
}) {
  if (!mongoose.isValidObjectId(applicationId)) return null
  if (!decisions.has(decision)) {
    throw requestError('Decision must be APPROVED or REJECTED.', 400)
  }
  if (decision === 'REJECTED' && (typeof reason !== 'string' || !reason.trim())) {
    throw requestError('A reason is required to reject an application.', 400)
  }
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 2000)) {
    throw requestError('Review notes must not exceed 2000 characters.', 400)
  }
  if (!generalOfficer?.id || !mongoose.isValidObjectId(generalOfficer.id)) {
    throw requestError('Authenticated General Officer identity is invalid.', 401)
  }

  const application = await Application.findOne({ _id: applicationId, status: 'ESCALATED' })
    .select('_id')
    .lean()
  if (!application) return null

  const now = new Date()
  const normalizedReason = reason?.trim() || null
  const updated = await Application.findOneAndUpdate(
    { _id: applicationId, status: 'ESCALATED' },
    {
      $set: {
        status: decision,
        'generalOfficerReview.decision': decision,
        'generalOfficerReview.decidedBy': generalOfficer.id,
        'generalOfficerReview.decidedAt': now,
        'generalOfficerReview.reason': normalizedReason,
      },
      $push: {
        'generalOfficerReview.notes': {
          generalOfficerId: generalOfficer.id,
          action: decision,
          reason: normalizedReason,
          at: now,
        },
      },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw requestError('This escalated application has already been resolved.', 409)
  await recordApplicationStatusTransition({
    applicationId,
    previousStatus: 'ESCALATED',
    newStatus: decision,
    actor: generalOfficer,
    action: `GENERAL_OFFICER_${decision}_APPLICATION`,
    reason: normalizedReason,
  })
  return serializeGeneralOfficerApplication(updated, { includeDocuments: true })
}

import Application, { ACTIVE_APPLICATION_STATUSES } from '../models/Application.mjs'
import Document from '../models/Document.mjs'

export async function findActiveDuplicateDocument({
  applicantId,
  applicationId,
  contentHashes,
}) {
  const hashes = [...new Set(contentHashes.filter((hash) => typeof hash === 'string' && hash))]
  if (!hashes.length) return null

  const matchingDocuments = await Document.find({
    applicantId,
    applicationId: { $ne: applicationId },
    contentHash: { $in: hashes },
  }).select('applicationId +contentHash').lean()
  if (!matchingDocuments.length) return null

  const activeApplications = await Application.find({
    _id: { $in: matchingDocuments.map(({ applicationId: id }) => id) },
    applicantId,
    status: { $in: ACTIVE_APPLICATION_STATUSES },
  }).select('applicationType applicationData.title').sort({ createdAt: 1, _id: 1 }).lean()

  return activeApplications[0] || null
}

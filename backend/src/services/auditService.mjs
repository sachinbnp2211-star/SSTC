import mongoose from 'mongoose'
import AuditEvent from '../models/AuditEvent.mjs'

export async function createAuditEvent({
  applicationId = null,
  documentId = null,
  actor,
  action,
  previousStatus = null,
  newStatus = null,
  reason = null,
}) {
  if (!actor?.id || !mongoose.isValidObjectId(actor.id)) {
    throw new Error('An authenticated actor is required to create an audit event.')
  }
  if (!actor.role) throw new Error('An authenticated actor role is required to create an audit event.')

  return AuditEvent.create({
    applicationId,
    documentId,
    actorId: actor.id,
    actorRole: actor.role,
    action,
    previousStatus,
    newStatus,
    reason,
    occurredAt: new Date(),
  })
}

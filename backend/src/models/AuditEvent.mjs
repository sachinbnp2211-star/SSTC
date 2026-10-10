import mongoose from 'mongoose'

const auditEventSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      default: null,
      index: true,
      immutable: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      default: null,
      index: true,
      immutable: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
      immutable: true,
    },
    actorRole: {
      type: String,
      enum: ['APPLICANT', 'OFFICER', 'GENERAL_OFFICER', 'HUMAN_VERIFIER', 'ADMIN'],
      required: true,
      immutable: true,
    },
    action: { type: String, required: true, trim: true, maxlength: 100, immutable: true },
    previousStatus: { type: String, default: null, maxlength: 40, immutable: true },
    newStatus: { type: String, default: null, maxlength: 40, immutable: true },
    reason: { type: String, default: null, maxlength: 2000, immutable: true },
    occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
)

auditEventSchema.pre('save', function preventAuditEventOverwrite() {
  if (!this.isNew) throw new Error('Audit events are append-only.')
})

for (const method of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'bulkWrite',
]) {
  auditEventSchema.pre(method, function preventAuditEventMutation() {
    throw new Error('Audit events are append-only.')
  })
}

const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema)

export default AuditEvent

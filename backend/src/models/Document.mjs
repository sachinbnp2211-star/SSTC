import mongoose from 'mongoose'

const correctedFieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    value: { type: String, required: true, maxlength: 10000 },
  },
  { _id: false },
)

const classificationCriticalFieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, enum: ['applicantName', 'annualIncome'] },
    status: { type: String, required: true, enum: ['CLEAR', 'UNCERTAIN', 'MISSING'] },
    modelConfidence: { type: Number, required: true, min: 0, max: 1 },
    value: { type: String, default: null, maxlength: 200 },
    evidence: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
)

const documentQualityFieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    status: { type: String, required: true, enum: ['CLEAR', 'UNCERTAIN', 'MISSING'] },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    value: { type: String, default: null, maxlength: 200 },
    evidence: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
)

const classificationSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['SUCCESS', 'FAILED', 'UNKNOWN_DEPARTMENT', 'INVALID_DEPARTMENT'], default: null },
    documentType: { type: String, trim: true, maxlength: 120, default: null },
    department: { type: String, trim: true, maxlength: 200, default: null },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    confidence: { type: Number, min: 0, max: 1, default: null },
    failureDescription: { type: String, maxlength: 500, default: null },
    consistency: { type: String, enum: ['CONSISTENT', 'INCONSISTENT', 'UNCERTAIN'], default: null },
    criticalFields: { type: [classificationCriticalFieldSchema], default: [], select: false },
  },
  { _id: false },
)

const qualityAssessmentSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['PASS', 'REVIEW'], required: true },
    reasonCode: { type: String, default: null },
    documentType: { type: String, trim: true, maxlength: 120, default: null },
    isReadable: { type: Boolean, required: true },
    qualityScore: { type: Number, min: 0, max: 1, required: true },
    modelFieldCompleteness: { type: Number, min: 0, max: 1, required: true },
    verifiedFieldCompleteness: { type: Number, min: 0, max: 1, required: true },
    ocrNoiseScore: { type: Number, min: 0, max: 1, required: true },
    safeForAutomation: { type: Boolean, required: true },
    consistency: { type: String, enum: ['CONSISTENT', 'INCONSISTENT', 'UNCERTAIN'], required: true },
    reason: { type: String, maxlength: 500, default: null },
    band: { type: String, enum: ['NORMAL_CONFIDENCE', 'MODERATE_CONFIDENCE', 'STRONG_LOW_CONFIDENCE', null], default: null },
    expectedFieldCount: { type: Number, min: 0, default: 0 },
    completeFieldCount: { type: Number, min: 0, default: 0 },
    evidenceSupportedFieldCount: { type: Number, min: 0, default: 0 },
    confidenceQualifiedFieldCount: { type: Number, min: 0, default: 0 },
    fields: { type: [documentQualityFieldSchema], default: [], select: false },
  },
  { _id: false },
)

const documentSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    applicantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    contentHash: {
      type: String,
      match: /^[a-f0-9]{64}$/,
      default: null,
      select: false,
    },
    originalFilename: {
      type: String,
      required: true,
      maxlength: 255,
    },
    documentType: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    mimeType: {
      type: String,
      required: true,
      enum: ['application/pdf', 'image/png', 'image/jpeg'],
    },
    fileSize: {
      type: Number,
      required: true,
      min: 1,
    },
    originalStorageId: {
      type: String,
      required: true,
      select: false,
    },
    extractedTextStorageId: {
      type: String,
      default: null,
      select: false,
    },
    ocrStatus: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'LOW_CONFIDENCE', 'FAILED'],
      default: 'PENDING',
      required: true,
      index: true,
    },
    ocrConfidence: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    ocrThreshold: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    humanVerificationRequired: {
      type: Boolean,
      default: false,
    },
    humanVerificationStatus: {
      type: String,
      enum: ['PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'CORRECTION_REQUIRED', null],
      default: null,
    },
    humanVerificationReason: {
      type: String,
      default: null,
      select: false,
    },
    humanVerificationDecision: {
      type: String,
      enum: ['VERIFIED', 'REJECTED', 'CORRECTION_REQUIRED', null],
      default: null,
    },
    humanReviewStartedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    humanReviewStartedAt: {
      type: Date,
      default: null,
    },
    humanVerifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    humanVerifiedAt: {
      type: Date,
      default: null,
    },
    humanVerificationNote: {
      type: String,
      maxlength: 2000,
      default: null,
      select: false,
    },
    correctedExtractedData: {
      type: [correctedFieldSchema],
      default: [],
      select: false,
    },
    ocrFailureCode: {
      type: String,
      default: null,
    },
    classification: {
      type: classificationSchema,
      default: null,
    },
    ocrQualityMetrics: {
      textLength: { type: Number, min: 0, default: null },
      wordCount: { type: Number, min: 0, default: null },
      alphanumericRatio: { type: Number, min: 0, max: 1, default: null },
      replacementCharacterRatio: { type: Number, min: 0, max: 1, default: null },
      suspiciousTokenRatio: { type: Number, min: 0, max: 1, default: null },
      repeatedTokenRatio: { type: Number, min: 0, max: 1, default: null },
    },
    qualityAssessment: {
      type: qualityAssessmentSchema,
      default: null,
      select: false,
    },
  },
  { timestamps: true },
)

documentSchema.index({
  ocrStatus: 1,
  humanVerificationRequired: 1,
  humanVerificationStatus: 1,
  createdAt: 1,
})
documentSchema.index({ applicantId: 1, contentHash: 1 })

const Document = mongoose.models.Document || mongoose.model('Document', documentSchema)

export default Document

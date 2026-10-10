import mongoose from 'mongoose'
import { VERIFICATION_REASON_CODES } from '../services/verificationReasonService.mjs'

export const APPLICATION_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'PROCESSING',
  'HUMAN_VERIFICATION',
  'OFFICER_REVIEW',
  'ROUTED',
  'WAITING_FOR_OFFICER',
  'WAITING_FOR_OFFICER_ASSIGNMENT',
  'ASSIGNED',
  'UNDER_REVIEW',
  'ESCALATED',
  'GENERAL_OFFICER_REVIEW',
  'CORRECTION_REQUIRED',
  'RESUBMITTED',
  'APPROVED',
  'REJECTED',
])

export const TERMINAL_APPLICATION_STATUSES = Object.freeze(['APPROVED', 'REJECTED'])
export const ACTIVE_APPLICATION_STATUSES = Object.freeze(APPLICATION_STATUSES.filter((status) =>
  status !== 'DRAFT' && !TERMINAL_APPLICATION_STATUSES.includes(status)))

const officerReviewNoteSchema = new mongoose.Schema(
  {
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['STARTED', 'APPROVED', 'REJECTED', 'ESCALATED'], required: true },
    note: { type: String, maxlength: 2000, default: null },
    at: { type: Date, required: true },
  },
  { _id: false },
)

const generalOfficerReviewNoteSchema = new mongoose.Schema(
  {
    generalOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['APPROVED', 'REJECTED'], required: true },
    reason: { type: String, maxlength: 2000, default: null },
    at: { type: Date, required: true },
  },
  { _id: false },
)

const verificationReasonSchema = new mongoose.Schema(
  {
    code: { type: String, enum: VERIFICATION_REASON_CODES, required: true },
    message: { type: String, required: true, maxlength: 500 },
    action: { type: String, required: true, maxlength: 1000 },
    documentId: { type: String, required: true },
    documentName: { type: String, required: true, maxlength: 255 },
    ocrStatus: { type: String, default: null },
    ocrConfidence: { type: Number, min: 0, max: 100, default: null },
    threshold: { type: Number, min: 0, max: 100, default: null },
    failureCode: { type: String, default: null },
    failureDescription: { type: String, default: null, maxlength: 500 },
    predictedDocumentType: { type: String, default: null, maxlength: 120 },
    predictedDepartment: { type: String, default: null, maxlength: 200 },
    classificationConfidence: { type: Number, min: 0, max: 1, default: null },
    fieldNames: { type: [String], default: [] },
    qualityScore: { type: Number, min: 0, max: 1, default: null },
    fieldCompleteness: { type: Number, min: 0, max: 1, default: null },
    ocrNoiseScore: { type: Number, min: 0, max: 1, default: null },
  },
  { _id: false },
)

const applicationSchema = new mongoose.Schema(
  {
    applicantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    applicationType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    applicationData: {
      title: { type: String, required: true, trim: true, maxlength: 160 },
      applicantName: { type: String, required: true, trim: true, maxlength: 160 },
      contactEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
      details: { type: String, required: true, trim: true, maxlength: 10000 },
    },
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: 'DRAFT',
      required: true,
      index: true,
    },
    processingDecision: {
      type: String,
      enum: ['AUTO_PROCESSED', 'HUMAN_VERIFICATION', null],
      default: null,
      index: true,
    },
    processingDecisionAt: {
      type: Date,
      default: null,
    },
    automationAssessment: {
      requiredFieldCount: { type: Number, min: 0, default: 0 },
      completeFieldCount: { type: Number, min: 0, default: 0 },
      evidenceSupportedFieldCount: { type: Number, min: 0, default: 0 },
      confidenceQualifiedFieldCount: { type: Number, min: 0, default: 0 },
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
    },
    assignedOfficerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    humanVerificationRequired: {
      type: Boolean,
      default: false,
      index: true,
    },
    humanVerificationStatus: {
      type: String,
      enum: ['PENDING', 'IN_REVIEW', 'PASSED', 'REJECTED', null],
      default: null,
    },
    humanVerificationReason: {
      type: String,
      default: null,
      maxlength: 2000,
    },
    verificationReasons: {
      type: [verificationReasonSchema],
      default: [],
    },
    humanVerificationDecision: {
      type: String,
      enum: ['PASS', 'REJECT', null],
      default: null,
    },
    humanVerifierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
    humanVerifiedAt: {
      type: Date,
      default: null,
    },
    humanVerificationRejectionReason: {
      type: String,
      default: null,
      maxlength: 2000,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    officerReview: {
      startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      startedAt: { type: Date, default: null },
      decision: { type: String, enum: ['APPROVED', 'REJECTED', 'ESCALATED', null], default: null },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      decidedAt: { type: Date, default: null },
      reason: { type: String, maxlength: 2000, default: null },
      notes: { type: [officerReviewNoteSchema], default: [] },
    },
    generalOfficerReview: {
      decision: { type: String, enum: ['APPROVED', 'REJECTED', null], default: null },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      decidedAt: { type: Date, default: null },
      reason: { type: String, maxlength: 2000, default: null },
      notes: { type: [generalOfficerReviewNoteSchema], default: [] },
    },
  },
  { timestamps: true },
)

const Application = mongoose.models.Application || mongoose.model('Application', applicationSchema)

export default Application

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'HUMAN_VERIFICATION'
  | 'OFFICER_REVIEW'
  | 'ROUTED'
  | 'WAITING_FOR_OFFICER'
  | 'WAITING_FOR_OFFICER_ASSIGNMENT'
  | 'ASSIGNED'
  | 'UNDER_REVIEW'
  | 'ESCALATED'
  | 'GENERAL_OFFICER_REVIEW'
  | 'CORRECTION_REQUIRED'
  | 'RESUBMITTED'
  | 'APPROVED'
  | 'REJECTED'

export type UserRole =
  | 'APPLICANT'
  | 'OFFICER'
  | 'GENERAL_OFFICER'
  | 'HUMAN_VERIFIER'
  | 'ADMIN'

export interface UserRecord {
  id: string
  email: string
  displayName: string
  role: UserRole
  departmentId?: string | null
  governmentOfficerId?: string | null
  permissions?: string[]
  isActive?: boolean
  accountStatus?: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | null
  mustChangePassword?: boolean
  officerRejectionReason?: string | null
  createdAt?: string
}

export interface DepartmentRecord {
  id: string
  name: string
  code?: string
  description?: string
  isActive?: boolean
  officerCount?: number
  pendingApplicationCount?: number
  createdAt?: string
  isCodeEditable?: boolean
}

export interface OfficerRegistrationRecord extends UserRecord {
  accountStatus: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED'
  officerApprovedAt?: string | null
  officerRejectedAt?: string | null
}

export interface OfficerRecord {
  id: string
  governmentOfficerId: string
  departmentId: string
}

export interface ApplicationDeadline {
  deadlineAt: string | null
  breachedAt: string | null
}

export interface ApplicationDocument {
  id: string
  applicationId?: string
  applicationType?: string | null
  name: string
  status: string
  addedAt: string
  mimeType: string
  fileSize: number
  documentType?: string
  ocrConfidence: number | null
  ocrThreshold: number | null
  humanVerificationRequired: boolean
  humanVerificationStatus: HumanVerificationStatus | null
  ocrStatus?: OcrStatus
  extractedText?: string
  correctedExtractedData?: VerifiedExtractedField[]
  humanVerificationDecision?: 'VERIFIED' | 'REJECTED' | 'CORRECTION_REQUIRED' | null
  humanVerifiedBy?: string | null
  humanVerifiedAt?: string | null
  humanVerificationNote?: string | null
}

export type OcrStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'LOW_CONFIDENCE'
  | 'FAILED'

export type HumanVerificationStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'CORRECTION_REQUIRED'

export interface HumanVerificationDocument {
  id: string
  applicationId: string
  applicationTitle: string
  applicantName: string
  documentType: string
  filename: string
  reason: string
  ocrScore: number
  ocrThreshold: number
  ocrStatus: OcrStatus
  extractedText: string
  humanVerificationStatus: HumanVerificationStatus
  submittedAt: string
  originalDocumentUrl?: string
}

export interface HumanVerificationApplicationDocument {
  id: string
  documentType: string
  filename: string
  mimeType: string
  ocrScore: number | null
  ocrThreshold: number | null
  ocrStatus: OcrStatus
  humanVerificationReason?: string | null
  ocrFailureCode?: string | null
  extractedText: string
  originalDocumentUrl: string
  submittedAt: string
}

export type VerificationReasonCode =
  | 'OCR_LOW_CONFIDENCE'
  | 'OCR_BELOW_MINIMUM_SAFE'
  | 'OCR_PROCESSING_FAILED'
  | 'AI_CLASSIFICATION_FAILED'
  | 'UNKNOWN_DEPARTMENT'
  | 'INVALID_AI_CLASSIFICATION'
  | 'INSUFFICIENT_OCR_TEXT'
  | 'CONFLICTING_CLASSIFICATIONS'
  | 'LOW_CLASSIFICATION_CONFIDENCE'
  | 'LOW_CONFIDENCE_AUTOMATION_UNSUPPORTED'
  | 'CRITICAL_FIELDS_MISSING'
  | 'CRITICAL_FIELDS_UNCERTAIN'
  | 'CRITICAL_FIELD_EVIDENCE_UNSUPPORTED'
  | 'DOCUMENT_INCONSISTENT'
  | 'AI_DOCUMENT_QUALITY_LOW'
  | 'INSUFFICIENT_FIELDS'

export interface VerificationReason {
  code: VerificationReasonCode
  message: string
  action: string
  documentId: string
  documentName: string
  ocrStatus: OcrStatus | null
  ocrConfidence: number | null
  threshold: number | null
  failureCode?: string | null
  failureDescription?: string | null
  predictedDocumentType?: string | null
  predictedDepartment?: string | null
  classificationConfidence?: number | null
  fieldNames?: string[]
  qualityScore?: number | null
  fieldCompleteness?: number | null
  ocrNoiseScore?: number | null
}

export interface HumanVerificationApplication {
  id: string
  applicationId: string
  applicationType: string
  title: string
  applicantName: string
  status: ApplicationStatus
  humanVerificationStatus: 'PENDING' | 'IN_REVIEW' | 'PASSED' | 'REJECTED'
  reason: string | null
  verificationReasons: VerificationReason[]
  submittedAt: string | null
  documentCount: number
  ocrScore: number | null
  documents: HumanVerificationApplicationDocument[]
  applicationData?: {
    title: string
    applicantName: string
    contactEmail: string
    details: string
  }
  humanVerificationReason?: string | null
  humanVerificationDecision?: 'PASS' | 'REJECT' | null
  humanVerificationRejectionReason?: string | null
}

export interface VerifiedExtractedField {
  name: string
  value: string
}

export interface TimelineEntry {
  id: string
  label: string
  detail?: string
  at: string
}

export type TimelineEvent = TimelineEntry

export interface Escalation {
  originatingOfficer: string
  createdAt: string
  note: string
}

export interface NotificationRecord {
  id: string
  title: string
  message: string
  createdAt: string
  read: boolean
}

export interface ApplicationRecord {
  id: string
  applicationType: string
  applicantId: string
  title: string
  applicantName: string
  contactEmail: string
  details: string
  status: ApplicationStatus
  rejectionReason?: string | null
  rejectedAt?: string | null
  processingDecision?: 'AUTO_PROCESSED' | 'HUMAN_VERIFICATION' | null
  automationAssessment?: {
    requiredFieldCount: number
    completeFieldCount: number
    evidenceSupportedFieldCount: number
    confidenceQualifiedFieldCount: number
  } | null
  department: string | null
  assignedOfficerId?: string | null
  assignedOfficerName?: string | null
  deadlineAt: ApplicationDeadline['deadlineAt']
  breachedAt: ApplicationDeadline['breachedAt']
  documents: ApplicationDocument[]
  timeline: TimelineEntry[]
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  escalation?: Escalation
  departmentId?: string
  applicant?: { id: string; name: string; email: string } | null
  officerReview?: {
    startedBy: string | null
    startedAt: string | null
    decision: 'APPROVED' | 'REJECTED' | 'ESCALATED' | null
    decidedBy: string | null
    decidedAt: string | null
    reason: string | null
    notes: {
      officerId: string
      officerName: string
      action: 'STARTED' | 'APPROVED' | 'REJECTED' | 'ESCALATED'
      note: string | null
      at: string
    }[]
  }
  generalOfficerReview?: {
    decision: 'APPROVED' | 'REJECTED' | null
    decidedBy: string | null
    decidedAt: string | null
    reason: string | null
    notes: {
      generalOfficerId: string
      generalOfficerName: string
      action: 'APPROVED' | 'REJECTED'
      reason: string | null
      at: string
    }[]
  }
}

export interface ApplicationDraft {
  applicationType: string
  title: string
  applicantName: string
  contactEmail: string
  details: string
}

export interface DeadlineSummary {
  deadlineAt: string | null
  breached: boolean
  remainingLabel: string | null
}

export type UserArea =
  | 'applicant'
  | 'officer'
  | 'general-officer'
  | 'human-verifier'
  | 'admin'
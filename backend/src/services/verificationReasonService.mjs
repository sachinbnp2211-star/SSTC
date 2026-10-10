export const VERIFICATION_REASON_CODES = Object.freeze([
  'OCR_LOW_CONFIDENCE',
  'OCR_BELOW_MINIMUM_SAFE',
  'OCR_PROCESSING_FAILED',
  'AI_CLASSIFICATION_FAILED',
  'UNKNOWN_DEPARTMENT',
  'INVALID_AI_CLASSIFICATION',
  'INSUFFICIENT_OCR_TEXT',
  'CONFLICTING_CLASSIFICATIONS',
  'LOW_CLASSIFICATION_CONFIDENCE',
  'LOW_CONFIDENCE_AUTOMATION_UNSUPPORTED',
  'CRITICAL_FIELDS_MISSING',
  'CRITICAL_FIELDS_UNCERTAIN',
  'CRITICAL_FIELD_EVIDENCE_UNSUPPORTED',
  'DOCUMENT_INCONSISTENT',
  'AI_DOCUMENT_QUALITY_LOW',
  'INSUFFICIENT_FIELDS',
])

const reasonContent = {
  OCR_LOW_CONFIDENCE: {
    message: (threshold) => `OCR confidence is below the required ${threshold}% threshold.`,
    action: 'Please manually verify the document.',
  },
  OCR_BELOW_MINIMUM_SAFE: {
    message: (threshold) => `OCR confidence is below the minimum safe processing score of ${threshold}%.`,
    action: 'Please manually verify the document.',
  },
  OCR_PROCESSING_FAILED: {
    message: 'OCR processing failed for this document.',
    action: 'Please manually verify the document.',
  },
  AI_CLASSIFICATION_FAILED: {
    message: 'AI document classification could not be completed.',
    action: 'The document was successfully processed by OCR, but automatic document classification could not be completed. Please verify the document and determine the appropriate department.',
  },
  UNKNOWN_DEPARTMENT: {
    message: 'Department could not be determined automatically.',
    action: 'The document was successfully processed, but the system could not confidently determine the appropriate department. Please review the document and select the correct department.',
  },
  INVALID_AI_CLASSIFICATION: {
    message: 'Automatic department classification returned an unrecognized result.',
    action: 'The system could not map the detected document category to an existing government department. Please verify the document and select the appropriate department.',
  },
  INSUFFICIENT_OCR_TEXT: {
    message: 'OCR completed but insufficient text was extracted.',
    action: 'The document could not provide enough readable text for reliable automatic classification. Please manually verify the document.',
  },
  CONFLICTING_CLASSIFICATIONS: {
    message: 'The documents were classified to different departments, so one department could not be selected safely.',
    action: 'Please review the document classifications and select the appropriate department.',
  },
  LOW_CLASSIFICATION_CONFIDENCE: {
    message: 'AI classification confidence was below the required level for automatic processing.',
    action: 'Please verify the document type and department manually.',
  },
  LOW_CONFIDENCE_AUTOMATION_UNSUPPORTED: {
    message: 'This document type is not eligible for the low-confidence automatic processing path.',
    action: 'Please verify the document and select the appropriate department.',
  },
  CRITICAL_FIELDS_MISSING: {
    message: 'One or more required document fields could not be extracted.',
    action: 'Please review the document and enter or confirm the missing information.',
  },
  CRITICAL_FIELDS_UNCERTAIN: {
    message: 'One or more required document fields are uncertain.',
    action: 'Please verify the uncertain information against the document.',
  },
  CRITICAL_FIELD_EVIDENCE_UNSUPPORTED: {
    message: 'Required document information could not be verified against the OCR text.',
    action: 'Please compare the extracted information with the original document.',
  },
  DOCUMENT_INCONSISTENT: {
    message: 'The document type or extracted information is internally inconsistent.',
    action: 'Please review the original document and determine the correct information.',
  },
  AI_DOCUMENT_QUALITY_LOW: {
    message: 'AI document-quality validation could not establish that this document is safe for automatic processing.',
    action: 'Please review the original document and verify its readability and classification.',
  },
  INSUFFICIENT_FIELDS: {
    message: 'Required document fields could not be reliably identified.',
    action: 'Please review the original document and verify the relevant fields.',
  },
}

function safeOcrFailureDescription(failureCode, maxPdfPages) {
  if (failureCode === 'PDF_PAGE_LIMIT') {
    return `OCR is limited to PDFs with at most ${maxPdfPages} pages.`
  }
  if (failureCode === 'OCR_PROCESSING_FAILED') {
    return 'The document was stored, but OCR processing failed. Please retry later.'
  }
  return 'The document could not be processed by OCR.'
}

export function createVerificationReason({
  code,
  document,
  threshold = document?.ocrThreshold ?? 90,
  minimumSafeThreshold = null,
  maxPdfPages,
  predictedDocumentType = null,
  predictedDepartment = null,
  classificationConfidence = null,
  fieldNames = [],
  qualityScore = null,
  fieldCompleteness = null,
  ocrNoiseScore = null,
  failureDescription = null,
}) {
  const content = reasonContent[code]
  if (!content) throw new Error(`Unsupported Human Verification reason code: ${code}.`)
  const reason = {
    code,
    message: typeof content.message === 'function'
      ? content.message(code === 'OCR_BELOW_MINIMUM_SAFE' ? minimumSafeThreshold : threshold)
      : content.message,
    action: content.action,
    documentId: String(document._id || document.id),
    documentName: document.originalFilename || document.documentName || 'Document',
    ocrStatus: document.ocrStatus || null,
    ocrConfidence: Number.isFinite(document.ocrConfidence) ? document.ocrConfidence : null,
    threshold: Number.isFinite(threshold) ? threshold : null,
    predictedDocumentType,
    predictedDepartment,
    classificationConfidence: Number.isFinite(classificationConfidence) ? classificationConfidence : null,
    ...(fieldNames.length ? { fieldNames: fieldNames.map((name) => String(name).slice(0, 100)) } : {}),
    qualityScore: Number.isFinite(qualityScore) ? qualityScore : null,
    fieldCompleteness: Number.isFinite(fieldCompleteness) ? fieldCompleteness : null,
    ocrNoiseScore: Number.isFinite(ocrNoiseScore) ? ocrNoiseScore : null,
  }

  if (code === 'OCR_PROCESSING_FAILED') {
    reason.failureCode = document.ocrFailureCode || null
    reason.failureDescription = safeOcrFailureDescription(document.ocrFailureCode, maxPdfPages)
  } else if (failureDescription) {
    reason.failureDescription = String(failureDescription).slice(0, 500)
  }
  return reason
}

export function createInsufficientOcrTextReason(document, minimumTextLength) {
  const reason = createVerificationReason({ code: 'INSUFFICIENT_OCR_TEXT', document })
  if (minimumTextLength && reason.message === 'OCR completed but insufficient text was extracted.') {
    reason.message = `OCR extracted fewer than ${minimumTextLength} characters required for reliable processing.`
  }
  return reason
}

export function getOcrVerificationReason(document, maxPdfPages) {
  if (document.ocrStatus === 'FAILED') {
    return createVerificationReason({
      code: 'OCR_PROCESSING_FAILED',
      document,
      maxPdfPages,
    })
  }
  if (document.ocrStatus === 'LOW_CONFIDENCE') {
    return createVerificationReason({ code: 'OCR_LOW_CONFIDENCE', document })
  }
  return null
}

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVerificationReason,
  createInsufficientOcrTextReason,
  getOcrVerificationReason,
  VERIFICATION_REASON_CODES,
} from '../src/services/verificationReasonService.mjs'

test('low OCR confidence reason includes document, score, and threshold', () => {
  const reason = getOcrVerificationReason({
    _id: 'document-1',
    originalFilename: 'Income_Certificate.pdf',
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 74.99,
    ocrThreshold: 75,
  })
  assert.deepEqual(reason, {
    code: 'OCR_LOW_CONFIDENCE',
    message: 'OCR confidence is below the required 75% threshold.',
    action: 'Please manually verify the document.',
    documentId: 'document-1',
    documentName: 'Income_Certificate.pdf',
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 74.99,
    threshold: 75,
    predictedDocumentType: null,
    predictedDepartment: null,
    classificationConfidence: null,
    qualityScore: null,
    fieldCompleteness: null,
    ocrNoiseScore: null,
  })
})

test('OCR processing failure maps known codes to safe explanations', () => {
  const reason = getOcrVerificationReason({
    id: 'document-2',
    originalFilename: 'Land_Record.pdf',
    ocrStatus: 'FAILED',
    ocrFailureCode: 'PDF_PAGE_LIMIT',
  }, 10)
  assert.equal(reason.code, 'OCR_PROCESSING_FAILED')
  assert.equal(reason.message, 'OCR processing failed for this document.')
  assert.equal(reason.failureCode, 'PDF_PAGE_LIMIT')
  assert.equal(reason.failureDescription, 'OCR is limited to PDFs with at most 10 pages.')
  assert.equal(reason.ocrConfidence, null)
  assert.equal(reason.threshold, 90)
})

test('classification and insufficient-text reasons have exact verifier messages', () => {
  const document = {
    id: 'document-3',
    originalFilename: 'record.pdf',
    ocrStatus: 'COMPLETED',
    ocrConfidence: 96,
    ocrThreshold: 90,
  }
  const expected = [
    ['AI_CLASSIFICATION_FAILED', 'AI document classification could not be completed.'],
    ['UNKNOWN_DEPARTMENT', 'Department could not be determined automatically.'],
    ['INVALID_AI_CLASSIFICATION', 'Automatic department classification returned an unrecognized result.'],
    ['INSUFFICIENT_OCR_TEXT', 'OCR completed but insufficient text was extracted.'],
  ]
  for (const [code, message] of expected) {
    assert.equal(createVerificationReason({ code, document }).message, message)
  }
  assert.deepEqual([...VERIFICATION_REASON_CODES].sort(), [
    ...expected.map(([code]) => code),
    'OCR_LOW_CONFIDENCE',
    'OCR_BELOW_MINIMUM_SAFE',
    'OCR_PROCESSING_FAILED',
    'CONFLICTING_CLASSIFICATIONS',
    'LOW_CLASSIFICATION_CONFIDENCE',
    'LOW_CONFIDENCE_AUTOMATION_UNSUPPORTED',
    'CRITICAL_FIELDS_MISSING',
    'CRITICAL_FIELDS_UNCERTAIN',
    'CRITICAL_FIELD_EVIDENCE_UNSUPPORTED',
    'DOCUMENT_INCONSISTENT',
    'AI_DOCUMENT_QUALITY_LOW',
    'INSUFFICIENT_FIELDS',
  ].sort())
})

test('low-confidence automation failures have safe structured verifier reasons', () => {
  const document = {
    _id: 'document-4',
    originalFilename: 'income-certificate.pdf',
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 68,
    ocrThreshold: 75,
  }
  const reason = createVerificationReason({
    code: 'CRITICAL_FIELDS_MISSING',
    document,
    predictedDocumentType: 'Income Certificate',
    predictedDepartment: 'Revenue',
    classificationConfidence: 0.94,
    fieldNames: ['annualIncome'],
  })

  assert.equal(reason.code, 'CRITICAL_FIELDS_MISSING')
  assert.equal(reason.message, 'One or more required document fields could not be extracted.')
  assert.deepEqual(reason.fieldNames, ['annualIncome'])
  assert.equal(reason.ocrConfidence, 68)
  assert.equal(reason.threshold, 75)
})

test('short low-confidence OCR reports the configured minimum text requirement', () => {
  const reason = createInsufficientOcrTextReason({
    id: 'document-5',
    originalFilename: 'short-scan.pdf',
    ocrStatus: 'LOW_CONFIDENCE',
    ocrConfidence: 68,
    ocrThreshold: 75,
  }, 80)
  assert.equal(reason.code, 'INSUFFICIENT_OCR_TEXT')
  assert.equal(reason.message, 'OCR extracted fewer than 80 characters required for reliable processing.')
})

test('extremely low confidence explains the stricter safe-processing floor', () => {
  const reason = createVerificationReason({
    code: 'OCR_BELOW_MINIMUM_SAFE',
    document: {
      id: 'document-6',
      originalFilename: 'unreadable.pdf',
      ocrStatus: 'LOW_CONFIDENCE',
      ocrConfidence: 47,
      ocrThreshold: 75,
    },
    minimumSafeThreshold: 50,
  })
  assert.equal(reason.message, 'OCR confidence is below the minimum safe processing score of 50%.')
})

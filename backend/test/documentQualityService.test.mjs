import test from 'node:test'
import assert from 'node:assert/strict'

import { getLowConfidenceAutomationConfig } from '../src/config/processingConfig.mjs'
import {
  calculateOcrQualityMetrics,
  calculateVerifiedFieldCompleteness,
  decideDocumentQuality,
  getExpectedDocumentFields,
} from '../src/services/documentQualityService.mjs'

const healthText = [
  'HEALTH CERTIFICATE',
  'Patient: Asha Sharma',
  'Certificate No: HC-2401',
  'Date: 2026-10-01',
  'Doctor: Dr Rao',
  'Hospital: City Hospital',
]
const config = getLowConfidenceAutomationConfig({
  OCR_THRESHOLD: '75',
  OCR_QUALITY_HARD_MINIMUM: '50',
  OCR_QUALITY_MODERATE_FLOOR: '60',
  OCR_QUALITY_MIN_TEXT_LENGTH: '30',
  OCR_QUALITY_MIN_WORD_COUNT: '4',
  OCR_QUALITY_MIN_SCORE: '0.85',
  OCR_QUALITY_STRONG_SCORE: '0.95',
  OCR_QUALITY_MIN_COMPLETENESS: '0.8',
  OCR_QUALITY_STRONG_COMPLETENESS: '0.95',
  OCR_QUALITY_MAX_NOISE: '0.2',
  OCR_QUALITY_STRONG_MAX_NOISE: '0.05',
  OCR_AUTOMATION_MIN_TEXT_LENGTH: '80',
  AI_CLASSIFICATION_MIN_CONFIDENCE: '0.9',
  AI_CRITICAL_FIELD_MIN_CONFIDENCE: '0.95',
})

test('decision thresholds are configurable and invalid ordering is rejected', () => {
  assert.equal(config.hardMinimum, 50)
  assert.equal(config.confidenceFloor, 60)
  assert.equal(config.ocrThreshold, 75)
  assert.equal(config.qualityMinimumScore, 0.85)
  assert.equal(config.qualityMinimumCompleteness, 0.8)
  assert.equal(config.qualityStrongScore, 0.95)
  assert.equal(config.qualityStrongCompleteness, 0.95)
  assert.throws(
    () => getLowConfidenceAutomationConfig({
      OCR_THRESHOLD: '75',
      OCR_QUALITY_HARD_MINIMUM: '60',
      OCR_QUALITY_MODERATE_FLOOR: '50',
    }),
    /confidence floors/,
  )
})

function qualityAssessment(overrides = {}) {
  return {
    documentType: 'Health Certificate',
    isReadable: true,
    qualityScore: 0.94,
    fieldCompleteness: 0.92,
    ocrNoiseScore: 0.08,
    safeForAutomation: true,
    consistency: 'CONSISTENT',
    ...overrides,
  }
}

function healthFields({ missingPurpose = true } = {}) {
  return [
    { name: 'patientName', status: 'CLEAR', confidence: 0.98, value: 'Asha Sharma', evidence: 'Patient: Asha Sharma' },
    { name: 'certificateNumber', status: 'CLEAR', confidence: 0.98, value: 'HC-2401', evidence: 'Certificate No: HC-2401' },
    { name: 'issueDate', status: 'CLEAR', confidence: 0.98, value: '2026-10-01', evidence: 'Date: 2026-10-01' },
    { name: 'issuingDoctor', status: 'CLEAR', confidence: 0.98, value: 'Dr Rao', evidence: 'Doctor: Dr Rao' },
    { name: 'healthInstitution', status: 'CLEAR', confidence: 0.98, value: 'City Hospital', evidence: 'Hospital: City Hospital' },
    {
      name: 'certificationPurpose',
      status: missingPurpose ? 'MISSING' : 'CLEAR',
      confidence: missingPurpose ? 0.4 : 0.98,
      value: missingPurpose ? null : 'Health assessment',
      evidence: missingPurpose ? null : 'Purpose: Health assessment',
    },
  ]
}

test('quality metrics quantify OCR size, characters, noise, and repetition deterministically', () => {
  const metrics = calculateOcrQualityMetrics('HEALTH CERTIFICATE\nPatient Asha 123')
  assert.equal(metrics.textLength, 35)
  assert.equal(metrics.wordCount, 5)
  assert.equal(metrics.replacementCharacterRatio, 0)
  assert.equal(metrics.repeatedTokenRatio, 0)
  assert.ok(metrics.alphanumericRatio > 0.8)
  assert.equal(calculateOcrQualityMetrics('� � � �').replacementCharacterRatio, 1)
  assert.ok(calculateOcrQualityMetrics('ERROR ERROR ERROR').repeatedTokenRatio > 0.8)
})

test('document type profiles provide different expected fields without imposing them on all types', () => {
  assert.equal(getExpectedDocumentFields('Health Certificate').length, 6)
  assert.equal(getExpectedDocumentFields('Income Certificate').length, 5)
  assert.equal(getExpectedDocumentFields('Unlisted form'), null)
})

test('moderate OCR confidence 70 passes only with quality and evidence-backed completeness', () => {
  const completeness = calculateVerifiedFieldCompleteness({
    documentType: 'Health Certificate',
    fields: healthFields(),
    ocrText: healthText.join('\n'),
    minimumFieldConfidence: 0.95,
  })
  assert.equal(completeness.fieldCompleteness, 5 / 6)
  assert.equal(completeness.evidenceSupportedFieldCount, 5)
  for (const ocrConfidence of [60, 70, 74.99]) {
    assert.equal(decideDocumentQuality({
      ocrConfidence,
      ocrMetrics: calculateOcrQualityMetrics(healthText.join('\n')),
      qualityAssessment: qualityAssessment(),
      verifiedFieldCompleteness: completeness,
      config,
    }).eligible, true)
  }
})

test('confidence at or above threshold bypasses quality signals; score below floor never passes', () => {
  const metrics = calculateOcrQualityMetrics(healthText.join('\n'))
  const fields = calculateVerifiedFieldCompleteness({
    documentType: 'Health Certificate',
    fields: [],
    ocrText: healthText.join('\n'),
    minimumFieldConfidence: 0.95,
  })
  const assessment = qualityAssessment()
  assert.equal(decideDocumentQuality({
    ocrConfidence: 80,
    ocrMetrics: metrics,
    qualityAssessment: assessment,
    verifiedFieldCompleteness: fields,
    config,
  }).eligible, true)
  assert.equal(decideDocumentQuality({
    ocrConfidence: 59.99,
    ocrMetrics: metrics,
    qualityAssessment: assessment,
    verifiedFieldCompleteness: fields,
    config,
  }).reasonCode, 'OCR_LOW_CONFIDENCE')
  assert.equal(decideDocumentQuality({
    ocrConfidence: 90,
    ocrMetrics: metrics,
    qualityAssessment: qualityAssessment({
      isReadable: false,
      safeForAutomation: false,
      qualityScore: 0,
      ocrNoiseScore: 1,
      consistency: 'INCONSISTENT',
    }),
    verifiedFieldCompleteness: fields,
    config,
  }).band, 'NORMAL_CONFIDENCE')
})

test('confidence 55 is below the automation floor regardless of AI quality', () => {
  const completeness = calculateVerifiedFieldCompleteness({
    documentType: 'Health Certificate',
    fields: healthFields({ missingPurpose: false }),
    ocrText: [...healthText, 'Purpose: Health assessment'].join('\n'),
    minimumFieldConfidence: 0.95,
  })
  const metrics = calculateOcrQualityMetrics([...healthText, 'Purpose: Health assessment'].join('\n'))
  assert.equal(decideDocumentQuality({
    ocrConfidence: 55,
    ocrMetrics: metrics,
    qualityAssessment: qualityAssessment({
      qualityScore: 0.97,
      ocrNoiseScore: 0.02,
      fieldCompleteness: 1,
    }),
    verifiedFieldCompleteness: completeness,
    config,
  }).reasonCode, 'OCR_LOW_CONFIDENCE')
  assert.equal(decideDocumentQuality({
    ocrConfidence: 55,
    ocrMetrics: metrics,
    qualityAssessment: qualityAssessment({
      qualityScore: 0.97,
      ocrNoiseScore: 0.02,
      fieldCompleteness: 1,
    }),
    verifiedFieldCompleteness: calculateVerifiedFieldCompleteness({
      documentType: 'Health Certificate',
      fields: healthFields(),
      ocrText: healthText.join('\n'),
      minimumFieldConfidence: 0.95,
    }),
    config,
  }).reasonCode, 'OCR_LOW_CONFIDENCE')
})

test('weak quality, missing evidence, or inconsistent model assessment requires verification', () => {
  const metrics = calculateOcrQualityMetrics(healthText.join('\n'))
  const completeness = calculateVerifiedFieldCompleteness({
    documentType: 'Health Certificate',
    fields: healthFields(),
    ocrText: healthText.join('\n'),
    minimumFieldConfidence: 0.95,
  })

  test('deterministic noise checks block severely corrupted OCR even if AI claims it is safe', () => {
    const metrics = calculateOcrQualityMetrics(
      `${healthText.join('\n')}\n${'�###@@@@ '.repeat(24)}`,
    )
    const decision = decideDocumentQuality({
      ocrConfidence: 70,
      ocrMetrics: metrics,
      qualityAssessment: qualityAssessment({ ocrNoiseScore: 0 }),
      verifiedFieldCompleteness: calculateVerifiedFieldCompleteness({
        documentType: 'Health Certificate',
        fields: healthFields({ missingPurpose: false }),
        ocrText: [...healthText, 'Purpose: Health assessment'].join('\n'),
        minimumFieldConfidence: 0.95,
      }),
      config,
    })
    assert.equal(decision.eligible, false)
    assert.equal(decision.reasonCode, 'AI_DOCUMENT_QUALITY_LOW')
  })
  for (const assessment of [
    qualityAssessment({ qualityScore: 0.6 }),
    qualityAssessment({ consistency: 'UNCERTAIN' }),
    qualityAssessment({ safeForAutomation: false }),
  ]) {
    assert.equal(decideDocumentQuality({
      ocrConfidence: 70,
      ocrMetrics: metrics,
      qualityAssessment: assessment,
      verifiedFieldCompleteness: completeness,
      config,
    }).eligible, false)
  }
  const missingEvidence = calculateVerifiedFieldCompleteness({
    documentType: 'Health Certificate',
    fields: healthFields().map((field) =>
      field.name === 'patientName' ? { ...field, evidence: 'not in OCR' } : field,
    ),
    ocrText: healthText.join('\n'),
    minimumFieldConfidence: 0.95,
  })
  assert.equal(decideDocumentQuality({
    ocrConfidence: 70,
    ocrMetrics: metrics,
    qualityAssessment: qualityAssessment(),
    verifiedFieldCompleteness: missingEvidence,
    config,
  }).eligible, false)
})

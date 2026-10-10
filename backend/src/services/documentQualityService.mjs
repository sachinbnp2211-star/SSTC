const documentFieldProfiles = new Map([
  ['health certificate', [
    'patientName',
    'certificateNumber',
    'issueDate',
    'issuingDoctor',
    'healthInstitution',
    'certificationPurpose',
  ]],
  ['medical certificate', [
    'patientName',
    'certificateNumber',
    'issueDate',
    'issuingDoctor',
    'healthInstitution',
    'certificationPurpose',
  ]],
  ['income certificate', [
    'applicantName',
    'certificateNumber',
    'annualIncome',
    'issueDate',
    'issuingAuthority',
  ]],
])

function normalizeDocumentType(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function normalizeComparableText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function getExpectedDocumentFields(documentType) {
  return documentFieldProfiles.get(normalizeDocumentType(documentType)) || null
}

export function calculateOcrQualityMetrics(text) {
  const value = typeof text === 'string' ? text : ''
  const visibleCharacters = value.replace(/\s/g, '')
  const tokens = value.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+/gu) || []
  const words = value.match(/[\p{L}\p{N}]+/gu) || []
  let repeatedTokenCount = 0
  for (let index = 0; index < words.length;) {
    let end = index + 1
    const normalized = words[index].normalize('NFKC').toLowerCase()
    while (end < words.length && words[end].normalize('NFKC').toLowerCase() === normalized) end += 1
    if (end - index > 1) repeatedTokenCount += end - index
    index = end
  }
  const lines = value.split(/\r?\n/).map((line) =>
    line.match(/[\p{L}\p{N}]+/gu) || [],
  )
  const lineCounts = new Map()
  for (const lineWords of lines) {
    if (!lineWords.length) continue
    const key = lineWords.map((word) => word.normalize('NFKC').toLowerCase()).join(' ')
    lineCounts.set(key, {
      count: (lineCounts.get(key)?.count || 0) + 1,
      wordCount: lineWords.length,
    })
  }
  for (const { count, wordCount } of lineCounts.values()) {
    if (count > 1) repeatedTokenCount += wordCount * (count - 1)
  }
  const suspiciousTokenCount = tokens.filter((token) =>
    token.includes('\uFFFD') ||
    /[^\p{L}\p{N}]{3,}/u.test(token) ||
    /(.)\1{4,}/u.test(token),
  ).length

  return {
    textLength: value.length,
    wordCount: words.length,
    alphanumericRatio: visibleCharacters.length
      ? (value.match(/[\p{L}\p{N}]/gu) || []).length / visibleCharacters.length
      : 0,
    replacementCharacterRatio: visibleCharacters.length
      ? (value.match(/\uFFFD/gu) || []).length / visibleCharacters.length
      : 0,
    suspiciousTokenRatio: tokens.length ? suspiciousTokenCount / tokens.length : 0,
    repeatedTokenRatio: words.length ? repeatedTokenCount / words.length : 0,
  }
}

export function hasSevereOcrNoise(metrics, config) {
  return metrics.replacementCharacterRatio > config.qualityMaximumNoise ||
    metrics.suspiciousTokenRatio > config.qualityMaximumNoise ||
    metrics.repeatedTokenRatio > config.qualityMaximumNoise ||
    metrics.alphanumericRatio < 1 - config.qualityMaximumNoise
}

export function calculateVerifiedFieldCompleteness({
  documentType,
  fields,
  ocrText,
  minimumFieldConfidence,
}) {
  const expectedFields = getExpectedDocumentFields(documentType)
  if (!expectedFields) {
    return {
      supported: false,
      expectedFieldCount: 0,
      completeFieldCount: 0,
      fieldCompleteness: 0,
      evidenceSupportedFieldCount: 0,
      confidenceQualifiedFieldCount: 0,
      fieldNames: [],
    }
  }

  const byName = new Map((Array.isArray(fields) ? fields : []).map((field) => [field.name, field]))
  let completeFieldCount = 0
  let evidenceSupportedFieldCount = 0
  let confidenceQualifiedFieldCount = 0
  let verifiedFieldCount = 0
  const fieldNames = []
  for (const name of expectedFields) {
    const field = byName.get(name)
    const clearValue = field?.status === 'CLEAR' &&
      typeof field.value === 'string' && Boolean(field.value.trim())
    const exactEvidence = clearValue && typeof field.evidence === 'string' &&
      field.evidence.length > 0 &&
      String(ocrText).includes(field.evidence) &&
      normalizeComparableText(field.evidence).includes(normalizeComparableText(field.value))
    const confidenceQualified = Number.isFinite(field?.confidence) &&
      field.confidence >= minimumFieldConfidence

    if (clearValue) completeFieldCount += 1
    if (exactEvidence) evidenceSupportedFieldCount += 1
    if (clearValue && confidenceQualified) confidenceQualifiedFieldCount += 1
    if (exactEvidence && confidenceQualified) verifiedFieldCount += 1
    if (!clearValue || !exactEvidence || !confidenceQualified) fieldNames.push(name)
  }

  return {
    supported: true,
    expectedFieldCount: expectedFields.length,
    completeFieldCount,
    fieldCompleteness: expectedFields.length ? verifiedFieldCount / expectedFields.length : 0,
    verifiedFieldCount,
    evidenceSupportedFieldCount,
    confidenceQualifiedFieldCount,
    fieldNames,
  }
}

export function decideDocumentQuality({
  ocrConfidence,
  ocrMetrics,
  qualityAssessment,
  verifiedFieldCompleteness,
  config,
}) {
  const fallback = (code) => ({ eligible: false, reasonCode: code })
  if (!Number.isFinite(ocrConfidence) || ocrConfidence < config.confidenceFloor) {
    return fallback('OCR_LOW_CONFIDENCE')
  }
  if (ocrConfidence >= config.ocrThreshold) {
    return { eligible: true, reasonCode: null, band: 'NORMAL_CONFIDENCE' }
  }
  if (ocrMetrics.textLength < config.qualityMinimumTextLength ||
      ocrMetrics.wordCount < config.qualityMinimumWordCount) {
    return fallback('INSUFFICIENT_OCR_TEXT')
  }
  if (hasSevereOcrNoise(ocrMetrics, config) ||
      qualityAssessment.ocrNoiseScore > config.qualityMaximumNoise) {
    return fallback('AI_DOCUMENT_QUALITY_LOW')
  }
  if (!qualityAssessment.isReadable ||
      qualityAssessment.qualityScore < config.qualityMinimumScore ||
      !qualityAssessment.safeForAutomation ||
      qualityAssessment.consistency !== 'CONSISTENT') {
    return fallback('AI_DOCUMENT_QUALITY_LOW')
  }

  if (!verifiedFieldCompleteness.supported) return fallback('LOW_CONFIDENCE_AUTOMATION_UNSUPPORTED')
  if (verifiedFieldCompleteness.fieldCompleteness < config.qualityMinimumCompleteness) {
    return fallback('INSUFFICIENT_FIELDS')
  }
  return { eligible: true, reasonCode: null, band: 'MODERATE_CONFIDENCE' }
}

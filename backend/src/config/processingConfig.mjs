export const DEFAULT_OCR_THRESHOLD = 90

export function getOcrThreshold(env = process.env) {
  const configuredValue = env.OCR_THRESHOLD
  if (configuredValue === undefined || configuredValue.trim() === '') {
    return DEFAULT_OCR_THRESHOLD
  }

  const threshold = Number(configuredValue)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error('OCR_THRESHOLD must be a number between 0 and 100.')
  }
  return threshold
}

export function getLowConfidenceAutomationConfig(env = process.env) {
  const ocrThreshold = getOcrThreshold(env)
  const confidenceFloor = Number(env.OCR_QUALITY_MODERATE_FLOOR ?? 60)
  const hardMinimum = Number(env.OCR_QUALITY_HARD_MINIMUM ?? 50)
  const minimumTextLength = Number(env.OCR_AUTOMATION_MIN_TEXT_LENGTH ?? 80)
  const qualityMinimumTextLength = Number(env.OCR_QUALITY_MIN_TEXT_LENGTH ?? 30)
  const qualityMinimumWordCount = Number(env.OCR_QUALITY_MIN_WORD_COUNT ?? 4)
  const qualityMinimumScore = Number(env.OCR_QUALITY_MIN_SCORE ?? 0.85)
  const qualityStrongScore = Number(env.OCR_QUALITY_STRONG_SCORE ?? 0.95)
  const qualityMinimumCompleteness = Number(env.OCR_QUALITY_MIN_COMPLETENESS ?? 0.8)
  const qualityStrongCompleteness = Number(env.OCR_QUALITY_STRONG_COMPLETENESS ?? 0.95)
  const qualityMaximumNoise = Number(env.OCR_QUALITY_MAX_NOISE ?? 0.2)
  const qualityStrongMaximumNoise = Number(env.OCR_QUALITY_STRONG_MAX_NOISE ?? 0.05)
  const classificationConfidence = Number(env.AI_CLASSIFICATION_MIN_CONFIDENCE ?? 0.9)
  const criticalFieldConfidence = Number(env.AI_CRITICAL_FIELD_MIN_CONFIDENCE ?? 0.95)
  if (!Number.isFinite(hardMinimum) || hardMinimum < 0 || hardMinimum >= confidenceFloor ||
      confidenceFloor >= ocrThreshold) {
    throw new Error('OCR quality confidence floors must satisfy 0 <= hard minimum < moderate floor < OCR_THRESHOLD.')
  }
  if (!Number.isInteger(minimumTextLength) || minimumTextLength < 1 || minimumTextLength > 5000) {
    throw new Error('OCR_AUTOMATION_MIN_TEXT_LENGTH must be an integer between 1 and 5000.')
  }
  if (!Number.isInteger(qualityMinimumTextLength) || qualityMinimumTextLength < 1 ||
      qualityMinimumTextLength > 5000 ||
      !Number.isInteger(qualityMinimumWordCount) || qualityMinimumWordCount < 1 ||
      qualityMinimumWordCount > 1000) {
    throw new Error('OCR quality minimum text length and word count must be valid positive integers.')
  }
  const qualityScores = [qualityMinimumScore, qualityStrongScore,
    qualityMinimumCompleteness, qualityStrongCompleteness, qualityMaximumNoise, qualityStrongMaximumNoise]
  if (qualityScores.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
      qualityStrongScore < qualityMinimumScore ||
      qualityStrongCompleteness < qualityMinimumCompleteness ||
      qualityStrongMaximumNoise > qualityMaximumNoise) {
    throw new Error('OCR quality scores, completeness, and noise limits must be valid values between 0 and 1.')
  }
  if (!Number.isFinite(classificationConfidence) ||
      classificationConfidence < 0 || classificationConfidence > 1) {
    throw new Error('AI_CLASSIFICATION_MIN_CONFIDENCE must be a number between 0 and 1.')
  }
  if (!Number.isFinite(criticalFieldConfidence) ||
      criticalFieldConfidence < 0 || criticalFieldConfidence > 1) {
    throw new Error('AI_CRITICAL_FIELD_MIN_CONFIDENCE must be a number between 0 and 1.')
  }
  return {
    ocrThreshold,
    confidenceFloor,
    hardMinimum,
    minimumTextLength,
    qualityMinimumTextLength,
    qualityMinimumWordCount,
    qualityMinimumScore,
    qualityStrongScore,
    qualityMinimumCompleteness,
    qualityStrongCompleteness,
    qualityMaximumNoise,
    qualityStrongMaximumNoise,
    classificationConfidence,
    criticalFieldConfidence,
  }
}

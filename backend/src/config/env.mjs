import dotenv from 'dotenv'

dotenv.config()

export const env = {
  PORT: Number(process.env.PORT || 4000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  OCR_THRESHOLD: process.env.OCR_THRESHOLD || '90',
  OCR_LANGUAGES: process.env.OCR_LANGUAGES || 'eng+hin',
  MONGODB_URI: process.env.MONGODB_URI || '',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  MAX_UPLOAD_SIZE_BYTES: Number(process.env.MAX_UPLOAD_SIZE_BYTES || 10 * 1024 * 1024),
  MAX_PDF_PAGES: Number(process.env.MAX_PDF_PAGES || 10),
  AI_CLASSIFICATION_API_URL: process.env.AI_CLASSIFICATION_API_URL || '',
  AI_CLASSIFICATION_API_KEY: process.env.AI_CLASSIFICATION_API_KEY || '',
  AI_CLASSIFICATION_MODEL: process.env.AI_CLASSIFICATION_MODEL || '',
  AI_CLASSIFICATION_TIMEOUT_MS: Number(process.env.AI_CLASSIFICATION_TIMEOUT_MS || 15000),
  OCR_QUALITY_HARD_MINIMUM: process.env.OCR_QUALITY_HARD_MINIMUM || '50',
  OCR_QUALITY_MODERATE_FLOOR: process.env.OCR_QUALITY_MODERATE_FLOOR || '60',
  OCR_AUTOMATION_MIN_TEXT_LENGTH: process.env.OCR_AUTOMATION_MIN_TEXT_LENGTH || '80',
  OCR_QUALITY_MIN_TEXT_LENGTH: process.env.OCR_QUALITY_MIN_TEXT_LENGTH || '30',
  OCR_QUALITY_MIN_WORD_COUNT: process.env.OCR_QUALITY_MIN_WORD_COUNT || '4',
  OCR_QUALITY_MIN_SCORE: process.env.OCR_QUALITY_MIN_SCORE || '0.85',
  OCR_QUALITY_STRONG_SCORE: process.env.OCR_QUALITY_STRONG_SCORE || '0.95',
  OCR_QUALITY_MIN_COMPLETENESS: process.env.OCR_QUALITY_MIN_COMPLETENESS || '0.8',
  OCR_QUALITY_STRONG_COMPLETENESS: process.env.OCR_QUALITY_STRONG_COMPLETENESS || '0.95',
  OCR_QUALITY_MAX_NOISE: process.env.OCR_QUALITY_MAX_NOISE || '0.2',
  OCR_QUALITY_STRONG_MAX_NOISE: process.env.OCR_QUALITY_STRONG_MAX_NOISE || '0.05',
  AI_CLASSIFICATION_MIN_CONFIDENCE: process.env.AI_CLASSIFICATION_MIN_CONFIDENCE || '0.9',
  AI_CRITICAL_FIELD_MIN_CONFIDENCE: process.env.AI_CRITICAL_FIELD_MIN_CONFIDENCE || '0.95',
  // The chatbot reuses the existing classification provider credentials when
  // dedicated chatbot overrides are not supplied.
  GROQ_API_KEY: process.env.GROQ_API_KEY || process.env.AI_CLASSIFICATION_API_KEY || '',
  GROQ_MODEL: process.env.GROQ_MODEL || (
    (process.env.AI_CLASSIFICATION_API_URL || '').includes('api.groq.com')
      ? process.env.AI_CLASSIFICATION_MODEL || 'llama-3.3-70b-versatile'
      : 'llama-3.3-70b-versatile'
  ),
}

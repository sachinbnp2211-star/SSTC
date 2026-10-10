import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWorker } from 'tesseract.js'
import { env } from '../config/env.mjs'

const require = createRequire(import.meta.url)
const { langPath: englishLangPath } = require('@tesseract.js-data/eng')
const workerCache = new Map()

function normalizeConfidence(value) {
  return Number.isFinite(value) ? value : 0
}

function countTsvRows(tsv, level) {
  if (typeof tsv !== 'string' || !tsv.trim()) return 0
  const rows = tsv.trim().split(/\r?\n/)
  if (rows.length <= 1) return 0
  let count = 0
  for (const row of rows.slice(1)) {
    const columns = row.split('\t')
    if (Number(columns[0]) === level) {
      count += 1
    }
  }
  return count
}

export function resolveOcrLanguagePreference(value = env.OCR_LANGUAGES) {
  const input = String(value || '').trim().toLowerCase()
  if (!input) return 'eng'

  const parts = input.split(/[,+\s]+/).filter(Boolean)
  if (parts.length === 0) return 'eng'

  const normalized = []
  for (const part of parts) {
    if (part === 'en' || part === 'english') normalized.push('eng')
    else if (part === 'hi' || part === 'hindi') normalized.push('hin')
    else if (part === 'eng' || part === 'hin') normalized.push(part)
  }

  const unique = [...new Set(normalized)]
  if (unique.length === 0) return 'eng'

  const ordered = ['eng', 'hin'].filter((language) => unique.includes(language))
  return ordered.length > 0 ? ordered.join('+') : 'eng'
}

export function getOcrLanguageConfig(languagePreference = env.OCR_LANGUAGES) {
  const languages = resolveOcrLanguagePreference(languagePreference)
  const selectedLanguages = languages.split('+').filter(Boolean)

  if (selectedLanguages.length === 1) {
    const packageName = `@tesseract.js-data/${selectedLanguages[0]}`
    try {
      const packageInfo = require(packageName)
      return { languages: selectedLanguages[0], langPath: packageInfo.langPath }
    } catch (error) {
      if (selectedLanguages[0] === 'eng') {
        return { languages: 'eng', langPath: englishLangPath }
      }
      throw new Error(`OCR language data for "${selectedLanguages[0]}" was not found. Install @tesseract.js-data/${selectedLanguages[0]} and retry.`)
    }
  }

  const combinedDirectory = path.join(os.tmpdir(), 'hackbios-ocr', selectedLanguages.join('+'))
  fs.mkdirSync(combinedDirectory, { recursive: true })

  for (const language of selectedLanguages) {
    const packageName = `@tesseract.js-data/${language}`
    const packageInfo = require(packageName)
    const source = path.join(packageInfo.langPath, `${language}.traineddata.gz`)
    if (!fs.existsSync(source)) {
      throw new Error(`OCR language data for "${language}" was not found in ${packageInfo.langPath}.`)
    }
    const destination = path.join(combinedDirectory, `${language}.traineddata.gz`)
    if (!fs.existsSync(destination)) {
      fs.copyFileSync(source, destination)
    }
  }

  return { languages, langPath: combinedDirectory }
}

export function aggregateOcrConfidence(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return 0
  const totalWeight = pages.reduce((sum, page) => sum + Math.max(String(page?.text || '').trim().length, 1), 0)
  if (!totalWeight) return 0
  const weightedConfidence = pages.reduce((sum, page) => {
    const textLength = Math.max(String(page?.text || '').trim().length, 1)
    return sum + normalizeConfidence(page?.confidence) * textLength
  }, 0)
  return Math.round(weightedConfidence / totalWeight)
}

export function summarizeOcrRun(pages, { provider = 'Tesseract.js', model = 'eng', languages } = {}) {
  const safePages = Array.isArray(pages) ? pages : []
  const pageCount = safePages.length
  const text = safePages.map((page) => String(page?.text || '').trim()).filter(Boolean).join('\n\n')
  const resolvedLanguages = Array.isArray(languages)
    ? languages
    : typeof languages === 'string' && languages.trim()
      ? languages.split('+').filter(Boolean)
      : model.split('+').filter(Boolean)
  return {
    provider,
    model: resolvedLanguages.join('+') || model,
    languages: resolvedLanguages,
    confidenceScale: '0-100',
    pageCount,
    characterCount: text.length,
    wordCount: safePages.reduce((sum, page) => sum + countTsvRows(page?.tsv, 5), 0),
    lineCount: safePages.reduce((sum, page) => sum + countTsvRows(page?.tsv, 4), 0),
    blockCount: safePages.reduce((sum, page) => sum + countTsvRows(page?.tsv, 2), 0),
    paragraphCount: safePages.reduce((sum, page) => sum + countTsvRows(page?.tsv, 3), 0),
    tableCount: 0,
    missingConfidencePageCount: safePages.filter((page) => !Number.isFinite(page?.confidence)).length,
    pageConfidences: safePages.map((page) => normalizeConfidence(page?.confidence)),
    textLength: text.length,
  }
}

async function getWorker(languagePreference = env.OCR_LANGUAGES) {
  const { languages, langPath } = getOcrLanguageConfig(languagePreference)
  const cacheKey = `${languages}@${langPath}`
  if (!workerCache.has(cacheKey)) {
    const workerPromise = createWorker(languages, 1, { langPath, gzip: true })
      .catch((error) => {
        workerCache.delete(cacheKey)
        throw error
      })
    workerCache.set(cacheKey, workerPromise)
  }
  return workerCache.get(cacheKey)
}

async function recognizePage(worker, image, output) {
  const result = await worker.recognize(image, {}, output)
  return {
    text: result.data.text,
    confidence: normalizeConfidence(result.data.confidence),
    tsv: result.data.tsv || null,
    blocks: Array.isArray(result.data.blocks) ? result.data.blocks : null,
  }
}

async function recognizePdf(buffer, worker, output) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
  })

  try {
    const document = await loadingTask.promise
    if (document.numPages > env.MAX_PDF_PAGES) {
      throw new Error(`PDF exceeds the ${env.MAX_PDF_PAGES}-page OCR limit.`)
    }

    const pages = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const unscaledViewport = page.getViewport({ scale: 1 })
      const scale = Math.min(
        1.75,
        4000 / Math.max(unscaledViewport.width, unscaledViewport.height),
        Math.sqrt(12_000_000 / (unscaledViewport.width * unscaledViewport.height)),
      )
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
      const context = canvas.getContext('2d')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      pages.push(await recognizePage(worker, canvas.toBuffer('image/png'), output))
      page.cleanup()
    }
    return pages
  } finally {
    await loadingTask.destroy()
  }
}

export async function recognizeDocument({ buffer, mimeType, languagePreference = env.OCR_LANGUAGES }) {
  const { languages } = getOcrLanguageConfig(languagePreference)
  const worker = await getWorker(languagePreference)
  const output = { blocks: true, tsv: true }
  let pages
  if (mimeType === 'application/pdf') {
    pages = await recognizePdf(buffer, worker, output)
  } else {
    pages = [await recognizePage(worker, buffer, output)]
  }

  const text = pages.map((page) => page.text.trim()).filter(Boolean).join('\n\n')
  const confidence = aggregateOcrConfidence(pages)

  return {
    text,
    confidence,
    diagnostics: summarizeOcrRun(pages, { provider: 'Tesseract.js', model: languages, languages: languages.split('+').filter(Boolean) }),
    language: languages,
  }
}

export async function terminateOcrWorker() {
  const pendingWorkers = [...workerCache.values()]
  workerCache.clear()
  await Promise.all(pendingWorkers.map(async (workerPromise) => {
    try {
      const worker = await workerPromise
      await worker.terminate()
    } catch (error) {
      // no-op: the worker may already have been cleaned up
    }
  }))
}

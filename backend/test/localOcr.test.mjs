import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import {
  aggregateOcrConfidence,
  getOcrLanguageConfig,
  recognizeDocument,
  resolveOcrLanguagePreference,
  summarizeOcrRun,
  terminateOcrWorker,
} from '../src/processing/localOcr.mjs'

const renderTextImage = (text, { width = 1200, height = 280, fontSize = 96, fontFamily = 'Devanagari MT' } = {}) => {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#000000'
  context.font = `700 ${fontSize}px "${fontFamily}"`
  context.textBaseline = 'middle'
  context.fillText(text, 50, height / 2)
  return canvas.toBuffer('image/png')
}

test.after(async () => {
  await terminateOcrWorker()
})

test('OCR confidence is weighted by extracted text length, not page count', () => {
  const pages = [
    { text: 'abc', confidence: 100, tsv: 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\tabc' },
    { text: 'abcdefghijklmnopqrstuv', confidence: 50, tsv: 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n4\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\tline\n5\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\tabcdefghijklmnopqrstuv' },
  ]
  const confidence = aggregateOcrConfidence(pages)
  assert.equal(confidence, 56)
})

test('missing confidence values are treated as zero instead of poisoning the score', () => {
  const confidence = aggregateOcrConfidence([
    { text: 'readable text', confidence: undefined },
    { text: 'more readable text', confidence: 80 },
  ])
  assert.equal(confidence, 46)
})

test('empty extraction still yields a deterministic zero score and safe diagnostics', () => {
  const pages = [
    { text: '', confidence: 90, tsv: 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext' },
    { text: '   ', confidence: 70, tsv: 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext' },
  ]
  assert.equal(aggregateOcrConfidence(pages), 80)
  const diagnostics = summarizeOcrRun(pages)
  assert.equal(diagnostics.pageCount, 2)
  assert.equal(diagnostics.characterCount, 0)
  assert.equal(diagnostics.wordCount, 0)
  assert.equal(diagnostics.lineCount, 0)
  assert.equal(diagnostics.blockCount, 0)
  assert.equal(diagnostics.tableCount, 0)
})

test('multi-page diagnostics include page, word, and block counts without leaking OCR text', () => {
  const pages = [
    {
      text: 'Page one text',
      confidence: 90,
      tsv: [
        'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
        '2\t1\t1\t0\t0\t0\t0\t0\t0\t0\t0\tBLOCK',
        '4\t1\t1\t1\t1\t0\t0\t0\t0\t0\t0\tLINE',
        '5\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\tPage',
        '5\t1\t1\t1\t1\t2\t0\t0\t0\t0\t0\tone',
      ].join('\n'),
    },
    {
      text: 'Page two text',
      confidence: 80,
      tsv: [
        'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
        '2\t1\t1\t0\t0\t0\t0\t0\t0\t0\t0\tBLOCK',
        '3\t1\t1\t1\t0\t0\t0\t0\t0\t0\t0\tPARA',
        '4\t1\t1\t1\t1\t0\t0\t0\t0\t0\t0\tLINE',
        '5\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\tPage',
        '5\t1\t1\t1\t1\t2\t0\t0\t0\t0\t0\ttwo',
      ].join('\n'),
    },
  ]
  const diagnostics = summarizeOcrRun(pages)
  assert.equal(diagnostics.pageCount, 2)
  assert.equal(diagnostics.blockCount, 2)
  assert.equal(diagnostics.lineCount, 2)
  assert.equal(diagnostics.paragraphCount, 1)
  assert.equal(diagnostics.wordCount, 4)
  assert.deepEqual(diagnostics.pageConfidences, [90, 80])
  assert.equal(diagnostics.confidenceScale, '0-100')
})

test('language configuration supports English, Hindi, and mixed-language OCR', () => {
  assert.equal(resolveOcrLanguagePreference('eng'), 'eng')
  assert.equal(resolveOcrLanguagePreference('Hindi'), 'hin')
  assert.equal(resolveOcrLanguagePreference('English+Hindi'), 'eng+hin')
  assert.equal(resolveOcrLanguagePreference('hin,eng'), 'eng+hin')

  const english = getOcrLanguageConfig('eng')
  assert.equal(english.languages, 'eng')
  assert.ok(english.langPath)

  const mixed = getOcrLanguageConfig('eng+hin')
  assert.equal(mixed.languages, 'eng+hin')
  assert.ok(mixed.langPath)
})

test('mixed-language OCR reads the same Hindi sample more reliably than English-only OCR', async () => {
  const englishOnly = await recognizeDocument({
    buffer: renderTextImage('भारत सरकार', { width: 1400, height: 260, fontSize: 120, fontFamily: 'Devanagari MT' }),
    mimeType: 'image/png',
    languagePreference: 'eng',
  })

  const mixed = await recognizeDocument({
    buffer: renderTextImage('भारत सरकार', { width: 1400, height: 260, fontSize: 120, fontFamily: 'Devanagari MT' }),
    mimeType: 'image/png',
    languagePreference: 'eng+hin',
  })

  assert.equal(englishOnly.diagnostics.model, 'eng')
  assert.equal(mixed.diagnostics.model, 'eng+hin')
  assert.ok(mixed.text.length > 0)
  assert.match(mixed.text, /भारत|सरकार/u)
  assert.doesNotMatch(englishOnly.text, /भारत|सरकार/u)
})

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import app from '../src/app.mjs'
import { getChatFallback, isWebsiteQuestion, sanitizeChatQuestion } from '../src/services/chatService.mjs'

let server
let baseUrl

before(async () => {
  server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

test('chat endpoint requires an authenticated applicant session', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'How do I register?' }),
  })
  assert.equal(response.status, 401)
})

test('chat question validation blocks secrets and oversized input', () => {
  assert.throws(() => sanitizeChatQuestion('My password is secret'), /do not send passwords/i)
  assert.throws(() => sanitizeChatQuestion('x'.repeat(1201)), /1200 characters/i)
})

test('FAQ fallback gives verified guidance without private application data', () => {
  const answer = getChatFallback('Why is human verification required?')
  assert.match(answer, /human verification/i)
  assert.doesNotMatch(answer, /application id|identity number|password/i)
})

test('chat scope accepts HacKBios topics and rejects unrelated questions', () => {
  assert.equal(isWebsiteQuestion('How do I upload a document?'), true)
  assert.equal(isWebsiteQuestion('Who won the match yesterday?'), false)
  assert.match(getChatFallback('Who won the match yesterday?'), /only answer questions about the HacKBios website/i)
})

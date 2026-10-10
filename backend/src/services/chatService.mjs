import { env } from '../config/env.mjs'

const MAX_QUESTION_LENGTH = 1200
const SENSITIVE_INPUT = /\b(password|passcode|otp|one[- ]time|session token|bearer token|api key|secret)\b/i
const WEBSITE_TOPIC_TERMS = [
  'hackbios', 'applicant', 'application', 'register', 'registration', 'sign up',
  'login', 'log in', 'account', 'service', 'document', 'upload', 'submit',
  'submission', 'pdf', 'png', 'jpeg', 'ocr', 'extraction', 'scan', 'department',
  'route', 'routing', 'status', 'progress', 'track', 'human verification',
  'verifier', 'manual review', 'review', 'support', 'help', 'deadline',
  'timeline', 'my applications', 'eligibility',
]
const OUT_OF_SCOPE_ANSWER = 'I can only answer questions about the HacKBios website, including registration, applications, document uploads, OCR, department routing, human verification, application status, and Help & Support. Please ask a HacKBios-related question or use human support.'

const VERIFIED_GUIDANCE = `
HacKBios project guidance:
- Applicants register through the Applicant registration page, then sign in to the Applicant Portal.
- An applicant starts an application from Apply for service, uploads PDF, PNG, or JPEG supporting documents, reviews the application, and submits it.
- OCR extracts document text and fields. OCR is an assistive suggestion, not a final decision. Unclear or incomplete extraction can send a document to human verification.
- Documents needing human verification remain in the verification workflow until an authorized verifier reviews the original and confirms or corrects fields.
- Applications are routed to the relevant department based on the submitted application type and department configuration. Applicants can view the current status, timeline, documents, and next action in My Applications.
- Statuses are recorded by the application workflow. The chatbot must not promise approval dates, invent eligibility rules, or claim a decision for a specific application.
- Applicants should use the Help & Support page or the human-support option for account-specific assistance. Never request or repeat passwords, OTPs, tokens, identity numbers, or full uploaded documents.
`

const FAQS = [
  {
    matches: ['register', 'registration', 'sign up', 'create account'],
    answer: 'To register, open Applicant registration, provide your display name, email, and password, then sign in to the Applicant Portal.',
  },
  {
    matches: ['submit', 'submission', 'upload', 'document'],
    answer: 'Start an application from Apply for service, upload a clear PDF, PNG, or JPEG document, review the extracted suggestions and details, then submit the application.',
  },
  {
    matches: ['ocr', 'extraction', 'scan', 'text'],
    answer: 'OCR provides extraction suggestions from uploaded documents. If text is unclear, incomplete, or uncertain, the document may be sent for human verification. Compare the suggestions with the original document and use the human-support option if needed.',
  },
  {
    matches: ['department', 'route', 'routing'],
    answer: 'Applications are routed to the relevant department using the submitted application type and the configured department workflow. The applicant can follow the recorded progress in My Applications.',
  },
  {
    matches: ['human verification', 'verifier', 'manual review', 'review required'],
    answer: 'Human verification means an authorized verifier needs to compare the document with the extracted fields and confirm or correct them before processing continues.',
  },
  {
    matches: ['status', 'progress', 'track', 'application state'],
    answer: 'Open My Applications and choose View details to see the recorded application status, timeline, documents, and next action. The chatbot cannot see or change a specific application.',
  },
]

function findFaqAnswer(question) {
  const normalized = question.toLowerCase()
  const match = FAQS.find((faq) => faq.matches.some((term) => normalized.includes(term)))
  return match?.answer || OUT_OF_SCOPE_ANSWER
}

export function isWebsiteQuestion(question) {
  const normalized = question.toLowerCase()
  return WEBSITE_TOPIC_TERMS.some((term) => normalized.includes(term))
}

export function sanitizeChatQuestion(value) {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('A question is required.'), { statusCode: 400 })
  }
  const question = value.trim()
  if (!question) {
    throw Object.assign(new Error('A question is required.'), { statusCode: 400 })
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw Object.assign(new Error(`Questions must be ${MAX_QUESTION_LENGTH} characters or fewer.`), { statusCode: 400 })
  }
  if (SENSITIVE_INPUT.test(question)) {
    throw Object.assign(new Error('For your security, do not send passwords, OTPs, tokens, API keys, or secrets in chat. Use human support for account help.'), { statusCode: 400 })
  }
  return question
}

export function getChatFallback(question) {
  return findFaqAnswer(question)
}

async function loadGroqClient() {
  if (!env.GROQ_API_KEY) return null
  try {
    const module = await import('groq-sdk')
    const Groq = module.default || module.Groq
    return new Groq({ apiKey: env.GROQ_API_KEY })
  } catch {
    return null
  }
}

export async function answerChatQuestion(question) {
  const safeQuestion = sanitizeChatQuestion(question)
  if (!isWebsiteQuestion(safeQuestion)) {
    return { message: OUT_OF_SCOPE_ANSWER, source: 'faq', fallback: true }
  }
  const fallback = getChatFallback(safeQuestion)
  const client = await loadGroqClient()
  if (!client) {
    return {
      message: fallback,
      source: 'faq',
      fallback: true,
      warning: 'AI chat is unavailable right now. This answer comes from the verified Help & Support FAQ.',
    }
  }

  try {
    const completion = await client.chat.completions.create({
      model: env.GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 350,
      messages: [
        { role: 'system', content: `You are the HacKBios Help & Support assistant. Answer only questions about features and workflows implemented on the HacKBios website, and use only the verified project guidance below. Do not answer general knowledge, news, unrelated technical, legal, medical, financial, or government-policy questions. For an unrelated question, say that you can only answer HacKBios website questions. Be concise, practical, and honest. If the question asks for private application details, a decision, eligibility rules, or information not covered here, say that you cannot access or verify it and direct the user to human support. Never ask for passwords, OTPs, tokens, identity numbers, or complete uploaded documents.\n${VERIFIED_GUIDANCE}` },
        { role: 'user', content: safeQuestion },
      ],
    })
    const message = completion.choices?.[0]?.message?.content?.trim()
    if (!message) throw new Error('Groq returned an empty response.')
    return { message, source: 'groq', fallback: false }
  } catch {
    return {
      message: fallback,
      source: 'faq',
      fallback: true,
      warning: 'AI chat could not be reached. This answer comes from the verified Help & Support FAQ.',
    }
  }
}

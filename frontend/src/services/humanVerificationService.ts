import type {
  HumanVerificationApplication,
  HumanVerificationDocument,
  VerifiedExtractedField,
} from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface ApiError {
  error?: string
}

interface QueueResponse {
  queue: HumanVerificationDocument[]
}

interface ReviewResponse {
  review: HumanVerificationDocument
}

interface DecisionResponse {
  result: {
    id: string
    humanVerificationStatus: 'VERIFIED' | 'REJECTED' | 'CORRECTION_REQUIRED'
    humanVerificationDecision: 'VERIFIED' | 'REJECTED' | 'CORRECTION_REQUIRED'
    humanVerifiedAt: string
  }
}

interface ApplicationQueueResponse {
  queue: Omit<HumanVerificationApplication, 'applicationData' | 'documents'>[]
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('authToken')
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers })
  let data: (T & ApiError) | undefined
  try {
    data = (await response.json()) as T & ApiError
  } catch {
    data = undefined
  }
  if (!response.ok) {
    throw new Error(data?.error || 'The human verification request could not be completed.')
  }
  if (!data) throw new Error('The server returned an invalid verification response.')
  return data
}

export const humanVerificationService = {
  async listApplications(status = 'PENDING') {
    const response = await request<ApplicationQueueResponse>(
      `/human-verification/applications?status=${encodeURIComponent(status)}`,
    )
    return response.queue
  },

  async getApplication(id: string) {
    const response = await request<{ application: HumanVerificationApplication }>(
      `/human-verification/applications/${encodeURIComponent(id)}`,
    )
    return response.application
  },

  async listDepartments() {
    const response = await request<{ departments: { id: string; name: string; code: string }[] }>(
      '/human-verification/departments',
    )
    return response.departments
  },

  async startApplicationReview(id: string) {
    return request<{ result: { id: string; humanVerificationStatus: 'IN_REVIEW' } }>(
      `/human-verification/applications/${encodeURIComponent(id)}/start-review`,
      { method: 'POST' },
    )
  },

  async decideApplication(
    id: string,
    decision: 'PASS' | 'REJECT',
    reason: string,
    departmentId?: string,
  ) {
    return request<{
      result: {
        applicationId: string
        status: string
        humanVerificationStatus: string
        department?: { id: string; name: string; code: string }
        assignedOfficerId?: string | null
        rejectionReason?: string
      }
    }>(`/human-verification/applications/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason, departmentId }),
    })
  },

  async listPending(status = 'ALL'): Promise<HumanVerificationDocument[]> {
    const response = await request<QueueResponse>(`/human-verification?status=${encodeURIComponent(status)}`)
    return response.queue
  },

  async startReview(id: string) {
    return request<{ result: { id: string; humanVerificationStatus: 'IN_REVIEW'; humanReviewStartedAt: string } }>(
      `/human-verification/${encodeURIComponent(id)}/start-review`,
      { method: 'POST' },
    )
  },

  async getForReview(id: string): Promise<HumanVerificationDocument> {
    const response = await request<ReviewResponse>(`/human-verification/${encodeURIComponent(id)}`)
    return response.review
  },

  async getOriginalDocument(id: string): Promise<Blob> {
    const token = localStorage.getItem('authToken')
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE_URL}/documents/${encodeURIComponent(id)}`,
      { headers },
    )
    if (!response.ok) {
      let message = 'The private original document could not be retrieved.'
      try {
        const data = (await response.json()) as ApiError
        message = data.error || message
      } catch {
        // The document endpoint may return a non-JSON transport error.
      }
      throw new Error(message)
    }
    return response.blob()
  },

  async decide(
    id: string,
    decision: 'VERIFIED' | 'REJECTED' | 'CORRECTION_REQUIRED',
    note: string,
    correctedFields: VerifiedExtractedField[],
  ): Promise<DecisionResponse['result']> {
    const response = await request<DecisionResponse>(
      `/human-verification/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, note, correctedFields }),
      },
    )
    return response.result
  },
}

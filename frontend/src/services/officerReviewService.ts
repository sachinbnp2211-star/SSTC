import type { ApplicationRecord } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface ApiError {
  error?: string
}

interface ApplicationResponse {
  application: ApplicationRecord
}

interface ApplicationsResponse {
  applications: ApplicationRecord[]
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
    throw new Error(data?.error || 'The Officer review request could not be completed.')
  }
  if (!data) throw new Error('The server returned an invalid Officer review response.')
  return data
}

export const officerReviewService = {
  async listAssigned(): Promise<ApplicationRecord[]> {
    const response = await request<ApplicationsResponse>('/officer/applications')
    return response.applications
  },

  async getApplication(id: string): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(`/officer/applications/${encodeURIComponent(id)}`)
    return response.application
  },

  async startReview(id: string): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(
      `/officer/applications/${encodeURIComponent(id)}/start-review`,
      { method: 'POST' },
    )
    return response.application
  },

  async decide(
    id: string,
    decision: 'APPROVED' | 'REJECTED' | 'ESCALATED',
    reason: string,
  ): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(
      `/officer/applications/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      },
    )
    return response.application
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
}

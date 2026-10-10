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

interface DashboardResponse {
  submissions: ApplicationRecord[]
}

interface SubmissionResponse {
  application: ApplicationRecord
  receipt: {
    applicationType: string
    applicationId: string
    applicantName: string
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('authToken')
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
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
  if (!response.ok) throw new Error(data?.error || 'The General Officer review request could not be completed.')
  if (!data) throw new Error('The server returned an invalid General Officer review response.')
  return data
}

export const generalOfficerReviewService = {
  async getDashboard(search = ''): Promise<DashboardResponse> {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    const query = params.toString()
    return request<DashboardResponse>(`/general-officer/dashboard${query ? `?${query}` : ''}`)
  },

  async submitApplication(form: FormData): Promise<SubmissionResponse> {
    return request<SubmissionResponse>('/general-officer/submissions', {
      method: 'POST',
      body: form,
    })
  },

  async getSubmission(id: string): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(
      `/general-officer/submissions/${encodeURIComponent(id)}`,
    )
    return response.application
  },

  async listEscalated(): Promise<ApplicationRecord[]> {
    const response = await request<ApplicationsResponse>('/general-officer/applications')
    return response.applications
  },

  async getEscalatedCase(id: string): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(
      `/general-officer/applications/${encodeURIComponent(id)}`,
    )
    return response.application
  },

  async decide(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
  ): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(
      `/general-officer/applications/${encodeURIComponent(id)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision, reason }) },
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

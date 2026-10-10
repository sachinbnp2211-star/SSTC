import type { ApplicationDraft, ApplicationRecord } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface ApplicationResponse {
  application: ApplicationRecord
}

interface ApplicationsResponse {
  applications: ApplicationRecord[]
}

interface ApiError {
  error?: string
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
    throw new Error(data?.error || 'The application request could not be completed.')
  }
  if (!data) {
    throw new Error('The server returned an invalid response.')
  }
  return data
}

export const applicationService = {
  async listForApplicant(): Promise<ApplicationRecord[]> {
    const response = await request<ApplicationsResponse>('/applications')
    return response.applications
  },

  async getForApplicant(id: string): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(`/applications/${encodeURIComponent(id)}`)
    return response.application
  },

  async create(draft: ApplicationDraft): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>('/applications', {
      method: 'POST',
      body: JSON.stringify(draft),
    })
    return response.application
  },

  async submit(id: string): Promise<ApplicationRecord> {
    const response = await request<ApplicationResponse>(`/applications/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
    })
    return response.application
  },
}

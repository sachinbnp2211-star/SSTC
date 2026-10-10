const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

export interface PublicApplicationStatus {
  id: string
  applicationType: string
  status: string
  submittedAt: string | null
  updatedAt: string
}

export const applicationStatusService = {
  async lookup(identifier: string): Promise<PublicApplicationStatus[]> {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}/application-status/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      })
    } catch {
      throw new Error('Application status could not be reached. Please try again.')
    }
    const data = await response.json().catch(() => null) as
      | { applications?: PublicApplicationStatus[]; error?: string }
      | null
    if (!response.ok) {
      throw new Error(data?.error || 'Application status lookup failed.')
    }
    if (!data || !Array.isArray(data.applications)) {
      throw new Error('The server returned an invalid application status response.')
    }
    return data.applications
  },
}

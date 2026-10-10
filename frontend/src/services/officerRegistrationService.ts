import type { UserRecord } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface ApiError {
  error?: string
}

export interface OfficerRegistrationStatus {
  governmentOfficerId?: string
  email?: string
  status: 'NOT_REGISTERED' | 'PENDING' | 'APPROVED' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED'
  passwordSetupAvailable: boolean
  passwordSetupUrl?: string
  rejectionReason?: string
}

export type OfficerRegistrationRole = 'OFFICER' | 'HUMAN_VERIFIER' | 'GENERAL_OFFICER'

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  registrationAccessToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers)
  if (registrationAccessToken) headers.set('Authorization', `Bearer ${registrationAccessToken}`)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })
  } catch {
    throw new Error('Unable to check registration status. Please try again.')
  }

  let data: (T & ApiError) | undefined
  try {
    data = (await response.json()) as T & ApiError
  } catch {
    data = undefined
  }
  if (!response.ok) {
    throw new Error(data?.error || 'Unable to check registration status. Please try again.')
  }
  if (!data) throw new Error('The server returned an invalid registration response.')
  return data
}

export const officerRegistrationService = {
  getStatus(
    role: OfficerRegistrationRole,
    identifier: string,
    registrationAccessToken?: string,
  ) {
    return request<OfficerRegistrationStatus>(
      '/officer/registration/status',
      {
        method: 'POST',
        body: JSON.stringify(role === 'OFFICER' || role === 'GENERAL_OFFICER'
          ? { role, governmentOfficerId: identifier }
          : { role, email: identifier }),
      },
      registrationAccessToken,
    )
  },

  async completePasswordSetup(
    role: OfficerRegistrationRole,
    identifier: string,
    registrationAccessToken: string,
    temporaryPassword: string,
  ) {
    const data = await request<{ user: UserRecord }>(
      '/officer/registration/setup',
      {
        method: 'POST',
        body: JSON.stringify(role === 'OFFICER' || role === 'GENERAL_OFFICER'
          ? { role, governmentOfficerId: identifier, temporaryPassword }
          : { role, email: identifier, temporaryPassword }),
      },
      registrationAccessToken,
    )
    return data.user
  },
}

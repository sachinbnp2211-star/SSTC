import type { UserRecord, UserRole } from '../types'

const API_BASE_URL =
  import.meta.env.VITE_API_URL || '/api'

interface AuthResponse {
  token: string
  user: UserRecord
}

interface ApiError {
  error?: string
}

export class AuthApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  networkErrorMessage?: string,
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })
  } catch (error) {
    if (networkErrorMessage && error instanceof TypeError) {
      throw new AuthApiError(networkErrorMessage, 0)
    }
    throw error
  }

  let data: (T & ApiError) | undefined
  try {
    data = (await response.json()) as T & ApiError
  } catch {
    data = undefined
  }

  if (!response.ok) {
    throw new AuthApiError(
      data?.error || (networkErrorMessage
        ? 'Unable to process the request right now. Please try again.'
        : 'Something went wrong.'),
      response.status,
    )
  }

  if (!data) {
    throw new AuthApiError(
      networkErrorMessage
        ? 'Unable to process the request right now. Please try again.'
        : 'The server returned an invalid response.',
      response.status,
    )
  }

  return data
}

function persistSession(data: AuthResponse) {
  localStorage.setItem('authToken', data.token)
  localStorage.setItem('authUser', JSON.stringify(data.user))
}

export const authService = {
  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthResponse> {
    const data = await request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    })

    persistSession(data)
    return data
  },

  async login(
    identifier: string,
    password: string,
  ): Promise<AuthResponse> {
    const data = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    })

    persistSession(data)
    return data
  },

  async requestPasswordReset(identifier: string): Promise<{ message: string; resetPath?: string }> {
    return request<{ message: string; resetPath?: string }>('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    })
  },

  async completePasswordReset(token: string, newPassword: string): Promise<{ message: string }> {
    return request<{ message: string }>('/auth/password-reset/complete', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    })
  },

  async validateOfficerRegistration(governmentOfficerId: string, role: 'OFFICER' | 'GENERAL_OFFICER' = 'OFFICER') {
    return request<{
      valid: true
      governmentOfficerId: string
      displayName: string
      officialEmail: string
      department: { id: string; name: string; code: string }
      reRegistered: boolean
    }>('/auth/officer-registration/validate', {
      method: 'POST',
      body: JSON.stringify({ governmentOfficerId, role }),
    }, 'Unable to connect to the server. Please try again.')
  },

  async registerOfficer(governmentOfficerId: string, role: 'OFFICER' | 'GENERAL_OFFICER' = 'OFFICER') {
    return request<{
      user: UserRecord
      department: { id: string; name: string; code: string }
      status: 'PENDING'
      reRegistered: boolean
      registrationAccessToken: string
      registrationAccessExpiresAt: string
    }>('/auth/officer-registration', {
      method: 'POST',
      body: JSON.stringify({ governmentOfficerId, role }),
    }, 'Unable to connect to the server. Please try again.')
  },

  async registerHumanVerifier(input: {
    email: string
    displayName: string
  }) {
    return request<{
      user: UserRecord
      department: null
      status: 'PENDING'
      reRegistered: boolean
      registrationAccessToken: string
      registrationAccessExpiresAt: string
    }>('/auth/officer-registration', {
      method: 'POST',
      body: JSON.stringify({ ...input, role: 'HUMAN_VERIFIER' }),
    }, 'Unable to connect to the server. Please try again.')
  },

  async completeOfficerSetup(setupToken: string, temporaryPassword: string, role: UserRole = 'OFFICER') {
    const data = await request<{ user: UserRecord }>('/auth/officer-setup', {
      method: 'POST',
      body: JSON.stringify({ setupToken, temporaryPassword, role }),
    })
    return data.user
  },

  async changeOfficerPassword(currentPassword: string, newPassword: string) {
    const token = localStorage.getItem('authToken')
    if (!token) throw new AuthApiError('Authentication required.', 401)
    const data = await request<AuthResponse>('/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    persistSession(data)
    return data
  },

  async getCurrentUser(): Promise<UserRecord> {
    const token = localStorage.getItem('authToken')
    if (!token) {
      throw new AuthApiError('Authentication required.', 401)
    }

    const data = await request<{ user: UserRecord }>('/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    localStorage.setItem('authUser', JSON.stringify(data.user))
    return data.user
  },

  async logout() {
    const token = localStorage.getItem('authToken')
    if (token) {
      try {
        await request<{ ok: true }>('/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch (error) {
        if (!(error instanceof AuthApiError && [401, 403].includes(error.status))) {
          throw error
        }
      }
    }
    this.clearLocalSession()
  },

  clearLocalSession() {
    localStorage.removeItem('authToken')
    localStorage.removeItem('authUser')
  },

  isAuthenticated() {
    return Boolean(localStorage.getItem('authToken'))
  },
}

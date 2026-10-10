import type { DepartmentRecord, OfficerRegistrationRecord, UserRecord } from '../types'
import type { AdminOverview } from '../types/admin'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface ApiError {
  error?: string
}

export class AdminApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const token = localStorage.getItem('authToken')
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  let data: (T & ApiError) | undefined
  try {
    data = (await response.json()) as T & ApiError
  } catch {
    data = undefined
  }

  if (!response.ok) {
    throw new AdminApiError(data?.error || 'Something went wrong.', response.status)
  }

  if (!data) {
    throw new AdminApiError('The server returned an invalid response.', response.status)
  }

  return data
}

export const adminService = {
  async getOverview() {
    return request<AdminOverview>('/admin/overview')
  },

  async listDepartments() {
    const data = await request<{ departments: DepartmentRecord[] }>('/admin/departments')
    return data.departments
  },

  async listUsers() {
    const data = await request<{ users: UserRecord[] }>('/admin/users')
    return data.users
  },

  async listOfficerRegistrations() {
    const data = await request<{ registrations: OfficerRegistrationRecord[] }>('/admin/officer-registrations')
    return data.registrations
  },

  async getOfficerRegistration(userId: string) {
    const data = await request<{ registration: OfficerRegistrationRecord }>(`/admin/officer-registrations/${userId}`)
    return data.registration
  },

  async approveOfficerRegistration(userId: string) {
    return request<{
      success: true
      message: string
      user: OfficerRegistrationRecord
      setupExpiresAt: string
    }>(`/admin/officer-registrations/${userId}/approve`, { method: 'POST' })
  },

  async reissueOfficerPasswordSetup(userId: string) {
    return request<{
      message: string
      setupExpiresAt: string
      setupPath?: string
    }>(`/admin/officer-registrations/${userId}/reissue-setup`, { method: 'POST' })
  },

  async rejectOfficerRegistration(userId: string, reason: string) {
    const data = await request<{ registration: OfficerRegistrationRecord }>(`/admin/officer-registrations/${userId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
    return data.registration
  },

  async createDepartment(payload: { name: string; code: string; description: string; isActive: boolean }) {
    const data = await request<{ department: DepartmentRecord }>('/admin/departments', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return data.department
  },

  async updateDepartment(departmentId: string, payload: { name: string; code: string; description: string }) {
    const data = await request<{ department: DepartmentRecord }>(`/admin/departments/${departmentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    return data.department
  },

  async createStaffUser(payload: {
    email: string
    password: string
    displayName: string
    role: 'OFFICER' | 'GENERAL_OFFICER' | 'HUMAN_VERIFIER'
    departmentId: string
    governmentOfficerId: string
  }) {
    const data = await request<{ user: UserRecord }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return data.user
  },

  async updateStaffUser(userId: string, payload: {
    role: 'OFFICER' | 'GENERAL_OFFICER' | 'HUMAN_VERIFIER'
    departmentId: string
    governmentOfficerId: string
  }) {
    const data = await request<{ user: UserRecord }>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    return data.user
  },

  async activateUser(userId: string) {
    const data = await request<{ user: UserRecord }>(`/admin/users/${userId}/activate`, {
      method: 'POST',
    })
    return data.user
  },

  async deactivateUser(userId: string) {
    const data = await request<{ user: UserRecord }>(`/admin/users/${userId}/deactivate`, {
      method: 'POST',
    })
    return data.user
  },

  async activateDepartment(departmentId: string) {
    const data = await request<{ department: DepartmentRecord }>(`/admin/departments/${departmentId}/activate`, {
      method: 'POST',
    })
    return data.department
  },

  async deactivateDepartment(departmentId: string) {
    const data = await request<{ department: DepartmentRecord }>(`/admin/departments/${departmentId}/deactivate`, {
      method: 'POST',
    })
    return data.department
  },
}

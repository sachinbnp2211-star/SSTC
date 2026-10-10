import type { ApplicationDocument } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface DocumentResponse {
  document?: ApplicationDocument
  error?: string
}

export class DocumentUploadError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DocumentUploadError'
    this.status = status
  }
}

export const documentService = {
  async uploadForApplicant(applicationId: string, file: File): Promise<ApplicationDocument> {
    const token = localStorage.getItem('authToken')
    const formData = new FormData()
    formData.append('file', file)
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(
      `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/documents`,
      { method: 'POST', headers, body: formData },
    )
    let data: DocumentResponse | undefined
    try {
      data = (await response.json()) as DocumentResponse
    } catch {
      data = undefined
    }
    if (!response.ok) {
      throw new DocumentUploadError(data?.error || 'The document could not be uploaded.', response.status)
    }
    if (!data?.document) {
      throw new Error('The server returned an invalid document response.')
    }
    return data.document
  },
}

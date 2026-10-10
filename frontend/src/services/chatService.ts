const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

export interface ChatReply {
  message: string
  source: 'groq' | 'faq'
  fallback: boolean
  warning?: string
}

interface ChatError {
  error?: string
}

export async function askChatbot(question: string): Promise<ChatReply> {
  const token = localStorage.getItem('authToken')
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question }),
  })
  const data = await response.json() as ChatReply & ChatError
  if (!response.ok) throw new Error(data.error || 'The support assistant could not respond.')
  return data
}

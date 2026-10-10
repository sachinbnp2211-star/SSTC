import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AuthApiError, authService } from '../services/authService'
import type { UserRecord, UserRole } from '../types'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

interface AuthContextValue {
  user: UserRecord | null
  status: AuthStatus
  error: string | null
  login(identifier: string, password: string): Promise<UserRecord>
  register(email: string, password: string, displayName: string): Promise<UserRecord>
  changeOfficerPassword(currentPassword: string, newPassword: string): Promise<UserRecord>
  logout(): Promise<void>
  retrySession(): Promise<void>
}

const roleHomePaths: Record<UserRole, string> = {
  APPLICANT: '/applicant',
  OFFICER: '/officer',
  GENERAL_OFFICER: '/general-officer',
  HUMAN_VERIFIER: '/human-verifier',
  ADMIN: '/admin',
}

const roleLoginPaths: Record<UserRole, string> = {
  APPLICANT: '/applicant/login',
  OFFICER: '/officer/login',
  GENERAL_OFFICER: '/general-officer/login',
  HUMAN_VERIFIER: '/human-verifier/login',
  ADMIN: '/admin/auth',
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function roleHomePath(role: UserRole) {
  return roleHomePaths[role]
}

export function roleLoginPath(role: UserRole) {
  return roleLoginPaths[role]
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(null)
  const [status, setStatus] = useState<AuthStatus>(() =>
    authService.isAuthenticated() ? 'loading' : 'unauthenticated',
  )
  const [error, setError] = useState<string | null>(null)

  const retrySession = useCallback(async () => {
    if (!authService.isAuthenticated()) {
      setUser(null)
      setStatus('unauthenticated')
      setError(null)
      return
    }

    setStatus('loading')
    setError(null)
    try {
      const currentUser = await authService.getCurrentUser()
      setUser(currentUser)
      setStatus('authenticated')
    } catch (reason) {
      if (reason instanceof AuthApiError && [401, 403].includes(reason.status)) {
        authService.clearLocalSession()
        setUser(null)
        setStatus('unauthenticated')
        setError(null)
        return
      }
      setStatus('error')
      setError(reason instanceof Error ? reason.message : 'Unable to restore your session.')
    }
  }, [])

  useEffect(() => {
    void retrySession()
  }, [retrySession])

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await authService.login(identifier, password)
    setUser(result.user)
    setStatus('authenticated')
    setError(null)
    return result.user
  }, [])

  const changeOfficerPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await authService.changeOfficerPassword(currentPassword, newPassword)
    setUser(result.user)
    setStatus('authenticated')
    setError(null)
    return result.user
  }, [])

  const register = useCallback(async (
    email: string,
    password: string,
    displayName: string,
  ) => {
    const result = await authService.register(email, password, displayName)
    setUser(result.user)
    setStatus('authenticated')
    setError(null)
    return result.user
  }, [])

  const logout = useCallback(async () => {
    await authService.logout()
    setUser(null)
    setStatus('unauthenticated')
    setError(null)
  }, [])

  const value = useMemo(
    () => ({ user, status, error, login, register, changeOfficerPassword, logout, retrySession }),
    [user, status, error, login, register, changeOfficerPassword, logout, retrySession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }
  return context
}

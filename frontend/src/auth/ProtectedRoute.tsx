import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { roleHomePath, roleLoginPath, useAuth } from './AuthContext'
import type { UserRole } from '../types'

export function ProtectedRoute({
  allowedRoles,
  allowOfficerPasswordChange = false,
  children,
}: {
  allowedRoles: UserRole[]
  allowOfficerPasswordChange?: boolean
  children: ReactNode
}) {
  const { user, status, error, retrySession } = useAuth()

  if (status === 'loading') {
    return <main className="auth-main" aria-live="polite">Restoring your session…</main>
  }

  if (status === 'error') {
    return (
      <main className="auth-main">
        <section className="auth-card" role="alert">
          <h1>Unable to verify your session</h1>
          <p>{error}</p>
          <button className="button button--primary" type="button" onClick={() => void retrySession()}>
            Try again
          </button>
        </section>
      </main>
    )
  }

  if (!user) {
    const intendedRole = allowedRoles[0]
    return <Navigate to={roleLoginPath(intendedRole)} replace />
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={roleHomePath(user.role)} replace />
  }

  if (user.role === 'OFFICER' && user.mustChangePassword) {
    return allowOfficerPasswordChange
      ? children
      : <Navigate to="/officer/change-password" replace />
  }
  if (allowOfficerPasswordChange) return <Navigate to="/officer" replace />

  return children
}

import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Brand } from './layout'

export type AdminSection = 'dashboard' | 'departments' | 'officers' | 'officer-registrations'

const navigation: { id: AdminSection; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◫' },
  { id: 'departments', label: 'Departments', icon: '⌂' },
  { id: 'officer-registrations', label: 'Officer registrations', icon: '✓' },
]

const sectionLabels: Record<AdminSection, string> = {
  dashboard: 'Dashboard',
  departments: 'Departments',
  officers: 'Officers & users',
  'officer-registrations': 'Officer registrations',
}

export function AdminLayout({
  section,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  children,
}: {
  section: AdminSection
  searchValue?: string
  searchPlaceholder?: string
  onSearchChange?: (value: string) => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const displayName = user?.displayName || 'Administrator'
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  async function handleLogout() {
    setSigningOut(true)
    setLogoutError('')
    try {
      await logout()
      navigate('/admin/auth', { replace: true })
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : 'Unable to sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="admin-shell">
      {mobileMenuOpen && (
        <button
          className="admin-sidebar-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={`admin-sidebar${mobileMenuOpen ? ' admin-sidebar--open' : ''}`}>
        <div className="admin-sidebar__brand">
          <Brand />
          <span className="admin-sidebar__tag">ADMIN PORTAL</span>
        </div>
        <p className="admin-sidebar__caption">WORKSPACE</p>
        <nav className="admin-nav" aria-label="Admin navigation">
          {navigation.map((item) => (
            <Link
              key={item.id}
              to={item.id === 'dashboard' ? '/admin' : `/admin?section=${item.id}`}
              aria-current={section === item.id ? 'page' : undefined}
              className={`admin-nav__link${section === item.id ? ' admin-nav__link--active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <span className="admin-nav__icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {section === item.id && <span className="admin-nav__indicator" aria-hidden="true" />}
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar__footer">
          <div className="admin-profile">
            <span className="admin-avatar" aria-hidden="true">{initials || 'A'}</span>
            <span className="admin-profile__copy">
              <strong>{displayName}</strong>
              <small>Global administrator</small>
            </span>
          </div>
          <button
            className="admin-logout"
            type="button"
            disabled={signingOut}
            onClick={() => void handleLogout()}
          >
            <span aria-hidden="true">↪</span>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          <Link className="admin-sidebar__home" to="/">Return to service portal</Link>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="admin-topbar__heading">
            <button
              className="admin-menu-toggle"
              type="button"
              aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">{mobileMenuOpen ? '×' : '☰'}</span>
            </button>
            <div>
              <p className="admin-breadcrumb"><Link to="/admin">Admin</Link><span aria-hidden="true">/</span>{sectionLabels[section]}</p>
              <h1>{sectionLabels[section]}</h1>
            </div>
          </div>
          <div className="admin-topbar__actions">
            {onSearchChange && (
              <label className="admin-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  aria-label="Search this section"
                  placeholder={searchPlaceholder || 'Search'}
                  value={searchValue || ''}
                  onChange={(event) => onSearchChange(event.target.value)}
                />
              </label>
            )}
            <span className="admin-topbar__identity">
              <span className="admin-avatar admin-avatar--small" aria-hidden="true">{initials || 'A'}</span>
              <span>{displayName}</span>
            </span>
            <button
              className="admin-topbar__logout"
              type="button"
              disabled={signingOut}
              onClick={() => void handleLogout()}
            >
              Sign out
            </button>
          </div>
        </header>
        {logoutError && <p className="admin-toast admin-toast--error" role="alert">{logoutError}</p>}
        <main className="admin-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}

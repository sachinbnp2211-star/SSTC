import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { roleHomePath, useAuth } from '../auth/AuthContext'
import { AuthLayout } from '../components/layout'
import { Field } from '../components/ui'
import { AuthApiError, authService } from '../services/authService'
import { applicationStatusService, type PublicApplicationStatus } from '../services/applicationStatusService'
import { officerRegistrationService } from '../services/officerRegistrationService'
import type { UserArea, UserRole } from '../types'

const roleNames: Record<Exclude<UserArea, 'applicant'>, string> = {
  officer: 'Officer',
  'general-officer': 'General Officer',
  'human-verifier': 'Human Verifier Officer',
  admin: 'Admin',
}

function officerRegistrationError(reason: unknown) {
  if (!(reason instanceof AuthApiError)) {
    return reason instanceof Error
      ? reason.message
      : 'Unable to process the request right now. Please try again.'
  }
  if (reason.status >= 500) return 'Unable to process the request right now. Please try again.'
  if (reason.status === 401) return 'You are not authorized to submit this request.'
  if (reason.status === 403) {
    return reason.message === 'This Government Officer ID is inactive.'
      ? reason.message
      : 'You are not authorized to submit this request.'
  }
  if (reason.status === 404) {
    return reason.message === 'Government Officer ID was not found.'
      ? reason.message
      : 'Unable to process the request right now. Please try again.'
  }
  if (reason.status === 409) {
    if (/awaiting administrator approval|already pending/i.test(reason.message)) {
      return 'Your registration is already awaiting administrator approval.'
    }
    if (/already has an account|account already exists/i.test(reason.message)) {
      return 'This officer already has an account.'
    }
  }
  return reason.message
}

export function ApplicantLoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const data = new FormData(event.currentTarget)

    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')

    setError('')
    setLoading(true)

    try {
      const user = await login(email, password)
      navigate(roleHomePath(user.role), { replace: true })
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Login failed.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to="/">
          ← Home
        </Link>

        <p className="eyebrow">APPLICANT ACCESS</p>

        <h1>Welcome back</h1>

        <p className="auth-card__intro">
          Sign in to view your applications and their progress.
        </p>

        {error && (
          <p className="form-alert form-alert--error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="form-stack">
          <Field
            label="Email address"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />

          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
            {!loading && <span aria-hidden="true"> →</span>}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/password/forgot?area=applicant">Forgot your password?</Link>
        </p>
        <p className="auth-switch">
          New to e-Governance?{' '}
          <Link to="/applicant/register">
            Create an account
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}

export function ApplicantStatusAccessPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [applications, setApplications] = useState<PublicApplicationStatus[] | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const identifier = String(data.get('identifier') ?? '').trim()
    setError('')
    setLoading(true)
    setApplications(null)
    try {
      setApplications(await applicationStatusService.lookup(identifier))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to retrieve application status.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to="/">← Home</Link>
        <p className="eyebrow">APPLICATION STATUS</p>
        <h1>Find your application</h1>
        <p className="auth-card__intro">Enter the email address used on your application or its Application ID.</p>
        {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
        <form onSubmit={(event) => void handleSubmit(event)} className="form-stack">
          <Field
            label="Email address or Application ID"
            type="text"
            name="identifier"
            autoComplete="email"
            placeholder="you@example.com or application ID"
            required
          />
          <button className="button button--primary button--full" type="submit" disabled={loading}>
            {loading ? 'Searching…' : 'Find application status'}
            {!loading && <span aria-hidden="true"> →</span>}
          </button>
        </form>
        {applications && (
          <section className="application-status-results" aria-live="polite">
            <h2>{applications.length ? 'Applications found' : 'No applications found'}</h2>
            {applications.length ? applications.map((application) => (
              <article className="application-status-result" key={application.id}>
                <h3>{application.applicationType}</h3>
                <p><strong>Status:</strong> {application.status.replaceAll('_', ' ')}</p>
                <p><strong>Application ID:</strong> <span className="application-status-result__id">{application.id}</span></p>
                {application.submittedAt && <p><strong>Submitted:</strong> {new Date(application.submittedAt).toLocaleString()}</p>}
                <p><strong>Last updated:</strong> {new Date(application.updatedAt).toLocaleString()}</p>
              </article>
            )) : <p className="muted">No matching application was found. Check the email address or Application ID and try again.</p>}
          </section>
        )}
        <p className="auth-switch">For full application details, <Link to="/applicant/login">sign in</Link> to your account.</p>
      </div>
    </AuthLayout>
  )
}

const passwordResetDestinations = new Set([
  '/applicant/login',
  '/officer/login',
  '/general-officer/login',
  '/human-verifier/login',
  '/admin/auth',
])
const passwordResetLoginPaths: Record<string, string> = {
  applicant: '/applicant/login',
  officer: '/officer/login',
  'general-officer': '/general-officer/login',
  'human-verifier': '/human-verifier/login',
  admin: '/admin/auth',
}

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams()
  const area = searchParams.get('area') || 'applicant'
  const isGeneralOfficer = area === 'general-officer'
  const isOfficer = area === 'officer'
  const usesOfficerId = isGeneralOfficer
  const fieldLabel = usesOfficerId
    ? 'General Officer ID'
    : isOfficer
      ? 'Government Officer ID or email'
      : 'Email address'
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [resetPath, setResetPath] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const identifier = String(data.get('identifier') ?? '').trim()
    setError('')
    setMessage('')
    setResetPath('')
    setLoading(true)
    try {
      const result = await authService.requestPasswordReset(identifier)
      setMessage(result.message)
      setResetPath(result.resetPath || '')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The reset request could not be completed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to="/">← Home</Link>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Forgot your password?</h1>
        <p className="auth-card__intro">Enter the email address or staff ID associated with your account. If it is eligible, we’ll send a one-time reset link.</p>
        {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
        {message && <p className="form-alert" role="status">{message}</p>}
        {resetPath && (
          <p className="form-alert">
            Development reset link: <Link to={resetPath}>Continue to reset password</Link>
          </p>
        )}
        <form onSubmit={(event) => void handleSubmit(event)} className="form-stack">
          <Field
            label={fieldLabel}
            type={isGeneralOfficer || isOfficer ? 'text' : 'email'}
            name="identifier"
            autoComplete={isGeneralOfficer || isOfficer ? 'username' : 'email'}
            placeholder={isGeneralOfficer ? 'ABC-123' : isOfficer ? 'ID or you@example.com' : 'you@example.com'}
            required
          />
          <button className="button button--primary button--full" type="submit" disabled={loading}>
            {loading ? 'Sending reset link…' : 'Send reset link'}
          </button>
        </form>
        <p className="auth-switch"><Link to={passwordResetLoginPaths[area] || '/applicant/login'}>Return to sign in</Link></p>
      </div>
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const requestedDestination = searchParams.get('returnTo') || ''
  const returnTo = passwordResetDestinations.has(requestedDestination)
    ? requestedDestination
    : '/applicant/login'
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const newPassword = String(data.get('newPassword') ?? '')
    const confirmPassword = String(data.get('confirmPassword') ?? '')
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await authService.completePasswordReset(token, newPassword)
      setMessage(result.message)
      window.setTimeout(() => navigate(returnTo, { replace: true }), 1200)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The password could not be reset.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to="/">← Home</Link>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Reset your password</h1>
        {!token ? <p className="form-alert form-alert--error" role="alert">This password reset link is missing or invalid. Request a new link.</p> : <>
          <p className="auth-card__intro">Choose a new password between 12 and 128 characters.</p>
          {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
          {message && <p className="form-alert" role="status">{message}</p>}
          {!message && <form onSubmit={(event) => void handleSubmit(event)} className="form-stack">
            <Field label="New password" type="password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
            <Field label="Confirm new password" type="password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
            <button className="button button--primary button--full" type="submit" disabled={loading}>{loading ? 'Resetting password…' : 'Reset password'}</button>
          </form>}
        </>}
        <p className="auth-switch"><Link to="/password/forgot">Request a new reset link</Link></p>
      </div>
    </AuthLayout>
  )
}

export function ApplicantRegistrationPage() {
  const navigate = useNavigate()
  const { register } = useAuth()

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const data = new FormData(event.currentTarget)

    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const confirmPassword = String(
      data.get('confirmPassword') ?? '',
    )
    const displayName = String(
      data.get('displayName') ?? '',
    )

    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const user = await register(email, password, displayName)
      navigate(roleHomePath(user.role), { replace: true })
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Registration failed.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to="/">
          ← Home
        </Link>

        <p className="eyebrow">APPLICANT ACCESS</p>

        <h1>Create account</h1>

        <p className="auth-card__intro">
          Use your email and password to begin an application.
        </p>

        {error && (
          <p className="form-alert form-alert--error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="form-stack">
          <Field
            label="Full name"
            type="text"
            name="displayName"
            autoComplete="name"
            placeholder="Your full name"
            required
          />

          <Field
            label="Email address"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />

          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
          />

          <Field
            label="Confirm password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
          />

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create account'}
            {!loading && <span aria-hidden="true"> →</span>}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account?{' '}
          <Link to="/applicant/login">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}

export function StaffLoginPage({
  area,
}: {
  area: Exclude<UserArea, 'applicant'>
}) {
  const navigate = useNavigate()
  const { login, logout } = useAuth()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const title = roleNames[area]
  const expectedRoles: Record<Exclude<UserArea, 'applicant'>, UserRole[]> = {
    officer: ['OFFICER'],
    'general-officer': ['GENERAL_OFFICER'],
    'human-verifier': ['HUMAN_VERIFIER'],
    admin: ['ADMIN'],
  } as const

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const identifier = String(data.get('identifier') ?? '')
    const password = String(data.get('password') ?? '')

    setError('')
    setLoading(true)
    try {
      const user = await login(identifier, password)
      if (!expectedRoles[area].includes(user.role)) {
        await logout()
        setError(`This account does not have access to the ${title} workspace.`)
        return
      }
      navigate(roleHomePath(user.role), { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to="/">
          ← Choose another workspace
        </Link>

        <p className="eyebrow">
          {title.toUpperCase()} ACCESS
        </p>

        <h1>
          {area === 'admin'
            ? 'Admin authentication'
            : `${title} sign in`}
        </h1>

        <p className="auth-card__intro">
          {area === 'officer'
            ? 'Sign in with your Government Officer ID and password.'
            : area === 'general-officer'
              ? 'Sign in with your General Officer ID and password.'
            : 'Sign in with the email and password associated with your account.'}
        </p>

        {error && (
          <p className="form-alert form-alert--error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="form-stack">
          <Field
            label={area === 'officer'
              ? 'Government Officer ID or email'
              : area === 'general-officer' ? 'General Officer ID' : 'Email address'}
            type={area === 'officer' || area === 'general-officer' ? 'text' : 'email'}
            name="identifier"
            autoComplete={area === 'officer' || area === 'general-officer' ? 'username' : 'email'}
            placeholder={area === 'officer' || area === 'general-officer' ? 'REV-001' : undefined}
            required
          />

          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        {area !== 'admin' && (
          <p className="auth-switch">
            <Link to={`/password/forgot?area=${encodeURIComponent(area)}`}>Forgot your password?</Link>
          </p>
        )}
        {area === 'officer' && (
          <p className="auth-switch">
            Need an Officer account?{' '}
            <Link to="/officer/access">Check registration status</Link>
          </p>
        )}
        {area === 'human-verifier' && (
          <p className="auth-switch">
            Need a Human Verifier account?{' '}
            <Link to="/human-verifier/register">Register for admin approval</Link>
            <br />
            Already registered? <Link to="/human-verifier/access">Check approval status</Link>
          </p>
        )}
        {area === 'general-officer' && (
          <p className="auth-switch">
            Need a General Officer account?{' '}
            <Link to="/general-officer/register">Register for Admin approval</Link>
            <br />
            Already registered? <Link to="/general-officer/access">Check approval status</Link>
          </p>
        )}
      </div>
    </AuthLayout>
  )
}

export function OfficerAccessPage() {
  return <RegistryOfficerAccessPage role="OFFICER" />
}

export function GeneralOfficerAccessPage() {
  return <RegistryOfficerAccessPage role="GENERAL_OFFICER" />
}

function RegistryOfficerAccessPage({ role }: { role: 'OFFICER' | 'GENERAL_OFFICER' }) {
  const [searchParams] = useSearchParams()
  const isGeneralOfficer = role === 'GENERAL_OFFICER'
  const basePath = isGeneralOfficer ? '/general-officer' : '/officer'
  const roleName = isGeneralOfficer ? 'General Officer' : 'Officer'
  const [governmentOfficerId, setGovernmentOfficerId] = useState(
    searchParams.get('governmentOfficerId') || searchParams.get('officerId') || '',
  )
  const [registration, setRegistration] = useState<{
    governmentOfficerId?: string
    status: string
    passwordSetupAvailable: boolean
    passwordSetupUrl?: string
    rejectionReason?: string
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const registrationAccessToken = localStorage.getItem(
    isGeneralOfficer ? 'generalOfficerRegistrationAccessToken' : 'officerRegistrationAccessToken',
  ) || ''

  async function checkStatus(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const officerId = governmentOfficerId.trim().toUpperCase()
    if (!officerId) {
      setError('Enter your Government Officer ID.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await officerRegistrationService.getStatus(role, officerId, registrationAccessToken || undefined)
      setRegistration(result)
      setGovernmentOfficerId(result.governmentOfficerId || officerId)
    } catch (reason) {
      setRegistration(null)
      setError(reason instanceof Error
        ? reason.message
        : 'Unable to check registration status. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to={`${basePath}/login`}>← {roleName} sign in</Link>
        <p className="eyebrow">{roleName.toUpperCase()} ACCESS</p>
        <h1>Check approval status</h1>
        <p className="auth-card__intro">Enter your Government Officer ID to check your registration status. Your ID is not a password and cannot authorize password setup.</p>
        {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
        <form onSubmit={(event) => void checkStatus(event)} className="form-stack">
          <Field
            label="Government Officer ID"
            name="governmentOfficerId"
            autoComplete="username"
            placeholder="REV-001"
            value={governmentOfficerId}
            onChange={(event) => {
              setGovernmentOfficerId(event.target.value.toUpperCase())
              setRegistration(null)
              setError('')
            }}
            required
          />
          <button className="button button--primary button--full" type="submit" disabled={loading}>
            {loading ? 'Checking…' : registration ? 'Check Again' : 'Check Approval Status'}
          </button>
        </form>
        {registration?.status === 'NOT_REGISTERED' && (
          <section className="form-alert" role="status">
            <strong>No registration request found</strong>
            <p>The Government Officer ID is valid. Submit a {roleName} registration request to continue.</p>
            <Link className="button button--secondary" to={`${basePath}/register?governmentOfficerId=${encodeURIComponent(registration.governmentOfficerId || governmentOfficerId)}`}>Register as a {roleName}</Link>
          </section>
        )}
        {registration?.status === 'PENDING' && (
          <section className="form-alert" role="status">
            <strong>Registration Pending</strong>
            <p>Your registration request has been submitted and is currently waiting for administrator approval.</p>
            <p>Please check again later.</p>
          </section>
        )}
        {registration?.status === 'REJECTED' && (
          <section className="form-alert form-alert--error" role="status">
            <strong>Registration Rejected</strong>
            <p>Your {roleName.toLowerCase()} registration was not approved.</p>
            {registration.rejectionReason && <p>Reason: {registration.rejectionReason}</p>}
          </section>
        )}
        {registration?.status === 'APPROVED' && (
          <section className="form-alert" role="status">
            <strong>Registration Approved ✓</strong>
            <p>Your {roleName.toLowerCase()} registration has been approved by the administrator.</p>
            <p>Your account is ready for password setup.</p>
            {registration.passwordSetupAvailable && registration.passwordSetupUrl && (
              <Link className="button button--primary" to={registration.passwordSetupUrl}>Set Up Your Password</Link>
            )}
          </section>
        )}
        {registration?.status === 'ACTIVE' && (
          <section className="form-alert" role="status">
            <strong>Your {roleName.toLowerCase()} account is active.</strong>
            <Link className="button button--primary" to={`${basePath}/login`}>Go to {roleName} Login</Link>
          </section>
        )}
        {registration?.status === 'SUSPENDED' && (
          <section className="form-alert form-alert--error" role="status">
            <strong>This {roleName} account is inactive.</strong>
            <p>Please contact the administrator.</p>
          </section>
        )}
        <p className="auth-switch">
          Need to register?{' '}
          <Link to={`${basePath}/register${governmentOfficerId ? `?governmentOfficerId=${encodeURIComponent(governmentOfficerId)}` : ''}`}>Register with your Government Officer ID</Link>
        </p>
      </div>
    </AuthLayout>
  )
}

export function HumanVerifierAccessPage() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [registration, setRegistration] = useState<{
    email?: string
    status: string
    passwordSetupAvailable: boolean
    passwordSetupUrl?: string
    rejectionReason?: string
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const registrationAccessToken = localStorage.getItem('humanVerifierRegistrationAccessToken') || ''

  async function checkStatus(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter the official email used during registration.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await officerRegistrationService.getStatus(
        'HUMAN_VERIFIER',
        normalizedEmail,
        registrationAccessToken || undefined,
      )
      setRegistration(result)
      setEmail(result.email || normalizedEmail)
    } catch (reason) {
      setRegistration(null)
      setError(reason instanceof Error ? reason.message : 'Unable to check registration status.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to="/human-verifier/login">← Human Verifier Officer sign in</Link>
        <p className="eyebrow">HUMAN VERIFIER OFFICER ACCESS</p>
        <h1>Check approval status</h1>
        <p className="auth-card__intro">Enter your official registration email. Email alone cannot authorize password setup; the registration credential from this browser is also required.</p>
        {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
        <form onSubmit={(event) => void checkStatus(event)} className="form-stack">
          <Field
            label="Official email address"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setRegistration(null)
              setError('')
            }}
            required
          />
          <button className="button button--primary button--full" type="submit" disabled={loading}>
            {loading ? 'Checking…' : registration ? 'Check Again' : 'Check Approval Status'}
          </button>
        </form>
        {registration?.status === 'NOT_REGISTERED' && (
          <section className="form-alert" role="status">
            <strong>No registration request found</strong>
            <p>Submit a Human Verifier Officer registration request to continue.</p>
            <Link className="button button--secondary" to={`/human-verifier/register?email=${encodeURIComponent(email)}`}>Register as a Human Verifier Officer</Link>
          </section>
        )}
        {registration?.status === 'PENDING' && (
          <section className="form-alert" role="status">
            <strong>Registration Pending</strong>
            <p>Your registration is waiting for administrator approval.</p>
            <p>Please check again later.</p>
          </section>
        )}
        {registration?.status === 'REJECTED' && (
          <section className="form-alert form-alert--error" role="status">
            <strong>Registration Rejected</strong>
            <p>Your Human Verifier Officer registration was not approved.</p>
            {registration.rejectionReason && <p>Reason: {registration.rejectionReason}</p>}
          </section>
        )}
        {registration?.status === 'APPROVED' && (
          <section className="form-alert" role="status">
            <strong>Registration Approved ✓</strong>
            <p>Your Human Verifier Officer registration has been approved by the administrator.</p>
            <p>Your account is ready for password setup.</p>
            {registration.passwordSetupAvailable && registration.passwordSetupUrl && (
              <Link className="button button--primary" to={registration.passwordSetupUrl}>Set Up Your Password</Link>
            )}
          </section>
        )}
        {registration?.status === 'ACTIVE' && (
          <section className="form-alert" role="status">
            <strong>Account Active ✓</strong>
            <p>Your Human Verifier Officer account is ready to use.</p>
            <Link className="button button--primary" to="/human-verifier/login">Go to Human Verifier Login</Link>
          </section>
        )}
        {registration?.status === 'SUSPENDED' && (
          <section className="form-alert form-alert--error" role="status">
            <strong>This Human Verifier Officer account is inactive.</strong>
            <p>Please contact the administrator.</p>
          </section>
        )}
        <p className="auth-switch">Need to register? <Link to={`/human-verifier/register${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Register as a Human Verifier Officer</Link></p>
      </div>
    </AuthLayout>
  )
}

export function OfficerRegistrationPage({ initialType = 'OFFICER' }: { initialType?: 'OFFICER' | 'HUMAN_VERIFIER' | 'GENERAL_OFFICER' }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [officerType, setOfficerType] = useState<'OFFICER' | 'HUMAN_VERIFIER' | 'GENERAL_OFFICER'>(initialType)
  const isRegistryOfficer = officerType === 'OFFICER' || officerType === 'GENERAL_OFFICER'
  const rolePath = officerType === 'GENERAL_OFFICER' ? '/general-officer' : officerType === 'OFFICER' ? '/officer' : '/human-verifier'
  const roleName = officerType === 'GENERAL_OFFICER' ? 'General Officer' : officerType === 'OFFICER' ? 'Officer' : 'Human Verifier Officer'
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [validatedIdentity, setValidatedIdentity] = useState<{
    departmentName: string
    governmentOfficerId: string
    displayName: string
    officialEmail: string
    reRegistered: boolean
  } | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const governmentOfficerId = String(data.get('governmentOfficerId') ?? '').trim()
    setError('')
    setLoading(true)
    try {
      if (isRegistryOfficer) {
        if (!validatedIdentity) {
          const result = await authService.validateOfficerRegistration(governmentOfficerId, officerType)
          setValidatedIdentity({
            departmentName: result.department.name,
            governmentOfficerId: result.governmentOfficerId,
            displayName: result.displayName,
            officialEmail: result.officialEmail,
            reRegistered: result.reRegistered,
          })
        } else {
          const result = await authService.registerOfficer(governmentOfficerId, officerType)
          localStorage.setItem(
            officerType === 'GENERAL_OFFICER' ? 'generalOfficerRegistrationAccessToken' : 'officerRegistrationAccessToken',
            result.registrationAccessToken,
          )
          navigate(`${rolePath}/access?governmentOfficerId=${encodeURIComponent(result.user.governmentOfficerId || governmentOfficerId)}`, { replace: true })
        }
      } else {
        const email = String(data.get('email') ?? '').trim().toLowerCase()
        const displayName = String(data.get('displayName') ?? '').trim()
        const result = await authService.registerHumanVerifier({ email, displayName })
        localStorage.setItem('humanVerifierRegistrationAccessToken', result.registrationAccessToken)
        navigate(`/human-verifier/access?email=${encodeURIComponent(result.user.email)}`, { replace: true })
      }
    } catch (reason) {
      if (isRegistryOfficer && reason instanceof AuthApiError && reason.status === 409) {
        navigate(`${rolePath}/access?governmentOfficerId=${encodeURIComponent(governmentOfficerId)}`, { replace: true })
        return
      }
      setError(isRegistryOfficer
        ? officerRegistrationError(reason)
        : reason instanceof Error ? reason.message : 'Unable to submit Human Verifier registration.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to={`${rolePath}/login`}>← {roleName} sign in</Link>
        <p className="eyebrow">{roleName.toUpperCase()} ACCESS</p>
        <h1>{roleName} registration</h1>
        <p className="auth-card__intro">
          {initialType === 'GENERAL_OFFICER'
            ? 'Enter your Government Officer ID to validate your registered identity. Your account is enabled only after administrator approval.'
            : 'Choose your officer type. All registrations are reviewed by an administrator before account access is enabled.'}
        </p>
        {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
        <form onSubmit={(event) => void handleSubmit(event)} className="form-stack">
          {initialType !== 'GENERAL_OFFICER' && <label className="field">
            <span className="field-label">Officer type</span>
            <select
              className="field-input"
              value={officerType}
              onChange={(event) => {
                setOfficerType(event.target.value as 'OFFICER' | 'HUMAN_VERIFIER' | 'GENERAL_OFFICER')
                setValidatedIdentity(null)
                setError('')
              }}
            >
              <option value="OFFICER">Government Officer</option>
              <option value="HUMAN_VERIFIER">Human Verifier Officer</option>
            </select>
          </label>}
          {isRegistryOfficer ? (
            <>
              <Field
                label="Government Officer ID"
                name="governmentOfficerId"
                autoComplete="username"
                placeholder="REV-001"
                defaultValue={searchParams.get('governmentOfficerId') || ''}
                onChange={() => { setValidatedIdentity(null); setError('') }}
                required
              />
              {validatedIdentity && (
                <section className="form-alert" role="status">
                  <strong>Identity validated</strong>
                  <p>Government Officer ID: {validatedIdentity.governmentOfficerId}</p>
                  <p>Registered name: {validatedIdentity.displayName}</p>
                  <p>Official email: {validatedIdentity.officialEmail}</p>
                  <p>Department: {validatedIdentity.departmentName}</p>
                  {validatedIdentity.reRegistered && <p>Your earlier rejected registration can be resubmitted for review.</p>}
                </section>
              )}
              <p className="muted">Name, official email, and Department come from the Government Officer registry and cannot be changed here. Your account is enabled after administrator approval.</p>
              <button className="button button--primary button--full" type="submit" disabled={loading}>
                {loading ? (validatedIdentity ? 'Submitting…' : 'Validating…') : (validatedIdentity ? 'Submit registration' : 'Validate identity')}
              </button>
              <p className="auth-switch">Already submitted a request? <Link to={`${rolePath}/access`}>Check approval status</Link></p>
            </>
          ) : (
            <>
              <Field label="Full name" name="displayName" autoComplete="name" maxLength={160} required />
              <Field
                label="Official email address"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={searchParams.get('email') || ''}
                required
              />
              <p className="muted">Human Verifier Officers are system-wide and are not assigned to a Department. Registration is reviewed by an administrator.</p>
              <button className="button button--primary button--full" type="submit" disabled={loading}>
                {loading ? 'Submitting…' : 'Submit registration'}
              </button>
              <p className="auth-switch">Already submitted a request? <Link to="/human-verifier/access">Check approval status</Link></p>
            </>
          )}
        </form>
      </div>
    </AuthLayout>
  )
}

export function HumanVerifierRegistrationPage() {
  return <OfficerRegistrationPage initialType="HUMAN_VERIFIER" />
}

export function GeneralOfficerRegistrationPage() {
  return <OfficerRegistrationPage initialType="GENERAL_OFFICER" />
}

export function OfficerSetupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const role: 'OFFICER' | 'HUMAN_VERIFIER' | 'GENERAL_OFFICER' = location.pathname.startsWith('/human-verifier/')
    ? 'HUMAN_VERIFIER'
    : location.pathname.startsWith('/general-officer/')
      ? 'GENERAL_OFFICER'
      : 'OFFICER'
  const setupToken = searchParams.get('token') || ''
  const governmentOfficerId = searchParams.get('officerId') || ''
  const email = searchParams.get('email') || ''
  const registrationMode = searchParams.get('registration') === '1'
  const isRegistryOfficer = role === 'OFFICER' || role === 'GENERAL_OFFICER'
  const registrationAccessToken = localStorage.getItem(
    role === 'OFFICER'
      ? 'officerRegistrationAccessToken'
      : role === 'GENERAL_OFFICER'
        ? 'generalOfficerRegistrationAccessToken'
        : 'humanVerifierRegistrationAccessToken',
  ) || ''
  const loginPath = role === 'OFFICER'
    ? '/officer/login'
    : role === 'GENERAL_OFFICER'
      ? '/general-officer/login'
      : '/human-verifier/login'
  const roleLabel = role === 'OFFICER' ? 'Officer' : role === 'GENERAL_OFFICER' ? 'General Officer' : 'Human Verifier Officer'
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    const confirmation = String(data.get('confirmPassword') ?? '')
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }
    setError('')
    setLoading(true)
    try {
      if (registrationMode) {
        await officerRegistrationService.completePasswordSetup(
          role,
          isRegistryOfficer ? governmentOfficerId : email,
          registrationAccessToken,
          password,
        )
        localStorage.removeItem(role === 'OFFICER'
          ? 'officerRegistrationAccessToken'
          : role === 'GENERAL_OFFICER'
            ? 'generalOfficerRegistrationAccessToken'
            : 'humanVerifierRegistrationAccessToken')
      } else {
        await authService.completeOfficerSetup(setupToken, password, role)
      }
      setComplete(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Password setup failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <Link className="back-link" to={loginPath}>← {roleLabel} sign in</Link>
        <p className="eyebrow">{roleLabel.toUpperCase()} ACCESS</p>
        <h1>Set Your Password</h1>
        {isRegistryOfficer && governmentOfficerId && <p>Government Officer ID: <strong>{governmentOfficerId}</strong></p>}
        {role === 'HUMAN_VERIFIER' && email && <p>Official email: <strong>{email}</strong></p>}
        {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
        {complete ? (
          <div className="form-alert" role="status">
            <p>Password setup is complete. Sign in with your {isRegistryOfficer ? 'registered email' : 'official email'} and this password.</p>
            <button className="button button--primary" type="button" onClick={() => navigate(loginPath, { replace: true })}>Go to {roleLabel} Login</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="form-stack">
            <p className="auth-card__intro">{registrationMode ? 'Your registration has been approved. Choose a password to activate your account.' : `Choose your ${roleLabel} account password. This one-time setup link expires and can only be used once.`}</p>
            <Field label="New password" type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            <Field label="Confirm password" type="password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
            <button className="button button--primary button--full" type="submit" disabled={loading || (registrationMode ? !registrationAccessToken || (isRegistryOfficer ? !governmentOfficerId : !email) : !setupToken)}>
              {loading ? 'Setting password…' : 'Set Password'}
            </button>
          </form>
        )}
      </div>
    </AuthLayout>
  )
}

export function OfficerChangePasswordPage() {
  const navigate = useNavigate()
  const { changeOfficerPassword } = useAuth()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const currentPassword = String(data.get('currentPassword') ?? '')
    const newPassword = String(data.get('newPassword') ?? '')
    if (newPassword !== String(data.get('confirmPassword') ?? '')) {
      setError('The new passwords do not match.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await changeOfficerPassword(currentPassword, newPassword)
      navigate('/officer', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <p className="eyebrow">OFFICER ACCESS</p>
        <h1>Change your password</h1>
        <p className="auth-card__intro">A password change is required before opening the Officer Dashboard.</p>
        {error && <p className="form-alert form-alert--error" role="alert">{error}</p>}
        <form onSubmit={handleSubmit} className="form-stack">
          <Field label="Current temporary password" type="password" name="currentPassword" autoComplete="current-password" required />
          <Field label="New password" type="password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
          <Field label="Confirm new password" type="password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
          <button className="button button--primary button--full" type="submit" disabled={loading}>
            {loading ? 'Updating…' : 'Change password'}
          </button>
        </form>
      </div>
    </AuthLayout>
  )
}
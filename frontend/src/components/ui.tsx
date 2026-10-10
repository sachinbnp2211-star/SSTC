import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ApplicationRecord, ApplicationStatus, NotificationRecord, TimelineEntry } from '../types'
import { deadlineService } from '../services/deadlineService'
import { useCurrentTime } from '../hooks/useCurrentTime'

const statusLabels: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PROCESSING: 'Processing',
  HUMAN_VERIFICATION: 'Human Verification Required',
  OFFICER_REVIEW: 'Officer review',
  ROUTED: 'Routed',
  WAITING_FOR_OFFICER: 'Waiting for Officer Assignment',
  WAITING_FOR_OFFICER_ASSIGNMENT: 'Waiting for Officer Assignment',
  ASSIGNED: 'Assigned - Waiting for Officer',
  UNDER_REVIEW: 'Under review',
  ESCALATED: 'Escalated',
  GENERAL_OFFICER_REVIEW: 'General Officer review',
  CORRECTION_REQUIRED: 'Correction required',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`status-badge status-badge--${status.toLowerCase().replaceAll('_', '-')}`}>{statusLabels[status]}</span>
}

export function DeadlineIndicator({ deadlineAt, breachedAt }: Pick<ApplicationRecord, 'deadlineAt' | 'breachedAt'>) {
  const currentTime = useCurrentTime()
  const summary = deadlineService.summarize(deadlineAt, breachedAt, currentTime)
  if (!summary.deadlineAt) return <div className="deadline"><span className="deadline__label">Deadline</span><span>Not assigned</span></div>

  return (
    <div className={`deadline ${summary.breached ? 'deadline--breached' : ''}`}>
      <span className="deadline__label">Deadline</span>
      <strong>{new Date(summary.deadlineAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
      <span className="deadline__state">{summary.breached ? 'Breached / overdue' : summary.remainingLabel}</span>
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {action && <div className="page-header__action">{action}</div>}
    </div>
  )
}

export function MetricCard({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: string }) {
  return (
    <article className="metric-card">
      <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon" aria-hidden="true">{icon}</span></div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="state-panel" role="status"><span className="spinner" aria-hidden="true" />{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <span className="state-panel__icon" aria-hidden="true">!</span>
      <div><strong>We couldn’t load this information.</strong><p>{message}</p>{onRetry && <button className="button button--secondary button--small" onClick={onRetry}>Try again</button>}</div>
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state__icon" aria-hidden="true">⌑</span><h3>{title}</h3><p>{description}</p>{action}</div>
}

export function Field({ label, error, hint, ...props }: { label: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}{props.required && <span aria-hidden="true"> *</span>}</label>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && <small className="field__error" id={`${id}-error`}>{error}</small>}
    </div>
  )
}

export function TextAreaField({ label, hint, ...props }: { label: string; hint?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}{props.required && <span aria-hidden="true"> *</span>}</label><textarea id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />{hint && <small id={`${id}-hint`}>{hint}</small>}</div>
}

export function OcrTextDisplay({ text }: { text?: string | null }) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return <div className="ocr-readable-empty">No text was extracted from this document.</div>
  return (
    <div className="ocr-readable" aria-label="Extracted document information">
      {lines.map((line, index) => {
        const fieldMatch = line.match(/^(.{1,72}?)(?:\s*[:：]\s*|\s+[-–]\s+)(.+)$/)
        const hasLabel = Boolean(fieldMatch)
        const label = fieldMatch?.[1].trim() || ''
        const value = fieldMatch?.[2].trim() || line
        return (
          <div className={`ocr-readable__line${hasLabel ? ' ocr-readable__line--field' : ''}`} key={`${index}-${line}`}>
            <span className="ocr-readable__index">{String(index + 1).padStart(2, '0')}</span>
            {hasLabel ? <><strong>{label}</strong><span>{value || '—'}</span></> : <span className="ocr-readable__text">{value}</span>}
          </div>
        )
      })}
    </div>
  )
}

export function ApplicationTable({ applications, hrefFor }: { applications: ApplicationRecord[]; hrefFor: (application: ApplicationRecord) => string }) {
  if (!applications.length) return <EmptyState title="No applications to show" description="Applications will appear here when available." />
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Application</th><th>Type</th><th>Applicant</th><th>Status</th><th>Created</th><th>Submitted</th><th>Updated</th><th><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{applications.map((application) => (
          <tr key={application.id}>
            <td><Link className="application-link" to={hrefFor(application)}><strong>{application.title}</strong><span>{application.id}</span></Link></td>
            <td>{application.applicationType}</td>
            <td>{application.applicantName}</td>
            <td><StatusBadge status={application.status} /></td>
            <td>{new Date(application.createdAt).toLocaleDateString()}</td>
            <td>{application.submittedAt ? new Date(application.submittedAt).toLocaleDateString() : 'Not submitted'}</td>
            <td>{new Date(application.updatedAt).toLocaleDateString()}</td>
            <td><Link className="button button--quiet button--small" to={hrefFor(application)}>View details <span aria-hidden="true">→</span></Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export function DocumentList({ documents }: { documents: ApplicationRecord['documents'] }) {
  if (!documents.length) return <p className="muted">No documents have been uploaded.</p>
  return <ul className="document-list">{documents.map((document) => {
    const status = document.humanVerificationRequired
      ? `Verification ${document.humanVerificationStatus || 'PENDING'}`
      : document.status === 'LOW_CONFIDENCE'
        ? 'Processing review'
        : document.status
    return <li key={document.id}><span className="document-list__icon" aria-hidden="true">▤</span><span className="document-list__name">{document.name}{document.applicationId && <small>Application ID: {document.applicationId} · Type: {document.applicationType || 'Unavailable'}</small>}<small>{document.mimeType} · {status}{!document.humanVerificationRequired && document.status === 'COMPLETED' ? ' · Human Verification not required' : ''}</small></span><span className="document-list__date">{new Date(document.addedAt).toLocaleDateString()}</span></li>
  })}</ul>
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return <ol className="timeline">{entries.map((entry) => <li key={entry.id}><span className="timeline__dot" aria-hidden="true" /><div><strong>{entry.label}</strong>{entry.detail && <p>{entry.detail}</p>}<time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></div></li>)}</ol>
}

export function NotificationPanel({ notifications }: { notifications: NotificationRecord[] }) {
  return (
    <section className="panel notification-panel" aria-labelledby="notifications-title">
      <div className="panel__heading">
        <div>
          <h2 className="panel__title" id="notifications-title">Notifications</h2>
          <p className="muted">Example messages only; no email or backend delivery is connected.</p>
        </div>
      </div>
      {notifications.length ? (
        <ul className="notification-list">
          {notifications.map((notification) => (
            <li
              className={notification.read ? 'notification-list__item' : 'notification-list__item notification-list__item--unread'}
              key={notification.id}
            >
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
                <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
              </div>
              {!notification.read && <span className="notification-list__new">New</span>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No notifications" description="Notifications will appear here when available." />
      )}
    </section>
  )
}

export function ConfirmationDialog({ title, children, confirmLabel, onConfirm, onCancel, busy = false }: { title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const confirmButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmButton.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{title}</h2><div className="dialog__body">{children}</div>
        <div className="dialog__actions"><button className="button button--secondary" onClick={onCancel} disabled={busy}>Cancel</button><button ref={confirmButton} className="button button--primary" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></div>
      </section>
    </div>
  )
}

export function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><h2 className="panel__title">{title}</h2>{children}</section>
}

export function ApplicationSummary({ application }: { application: ApplicationRecord }) {
  return <dl className="summary-grid"><div><dt>Application type</dt><dd>{application.applicationType}</dd></div><div><dt>Applicant</dt><dd>{application.applicantName}</dd></div><div><dt>Contact email</dt><dd>{application.contactEmail}</dd></div><div><dt>Department</dt><dd>{application.department ?? 'Not yet determined'}</dd></div><div><dt>Assigned Officer</dt><dd>{application.assignedOfficerName ?? 'Not yet assigned'}</dd></div><div><dt>Workflow status</dt><dd><StatusBadge status={application.status} /></dd></div></dl>
}

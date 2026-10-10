import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { DashboardLayout } from '../components/layout'
import {
  ApplicationSummary,
  ApplicationTable,
  ConfirmationDialog,
  DeadlineIndicator,
  EmptyState,
  ErrorState,
  InfoCard,
  LoadingState,
  MetricCard,
  OcrTextDisplay,
  PageHeader,
  StatusBadge,
  TextAreaField,
  Timeline,
} from '../components/ui'
import { officerReviewService } from '../services/officerReviewService'
import type { ApplicationDocument, ApplicationRecord, ApplicationStatus } from '../types'
import { useCurrentTime } from '../hooks/useCurrentTime'

type OfficerDecision = 'APPROVED' | 'REJECTED' | 'ESCALATED'

const isBreached = (application: ApplicationRecord, now: number) =>
  Boolean(application.breachedAt) ||
  Boolean(application.deadlineAt && new Date(application.deadlineAt).getTime() < now)

const isDueSoon = (application: ApplicationRecord, now: number) => {
  if (!application.deadlineAt || isBreached(application, now)) return false
  const remaining = new Date(application.deadlineAt).getTime() - now
  return remaining >= 0 && remaining <= 3 * 86_400_000
}

function OfficerDocumentCard({ document }: { document: ApplicationDocument }) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [originalUrl, setOriginalUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    let objectUrl = ''
    if (showOriginal) {
      setLoading(true)
      setError('')
      officerReviewService.getOriginalDocument(document.id)
        .then((blob) => {
          if (!current) return
          objectUrl = URL.createObjectURL(blob)
          setOriginalUrl(objectUrl)
        })
        .catch((reason: unknown) => {
          if (current) setError(reason instanceof Error ? reason.message : 'The original document could not be loaded.')
        })
        .finally(() => { if (current) setLoading(false) })
    } else {
      setOriginalUrl('')
    }
    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [document.id, showOriginal])

  return (
    <article className="officer-document">
      <div className="panel__heading">
        <div>
          <h3>{document.name}</h3>
          <p className="muted">{document.documentType} · {new Date(document.addedAt).toLocaleString()}</p>
        </div>
        <span className="inline-status">{document.humanVerificationStatus || (document.ocrStatus === 'LOW_CONFIDENCE' ? 'Verification pending' : document.ocrStatus || document.status)}</span>
      </div>
      <dl className="summary-grid">
        <div><dt>Human verification</dt><dd>{document.humanVerificationStatus || 'Not required'}</dd></div>
        {document.humanVerificationDecision && <div><dt>Verification decision</dt><dd>{document.humanVerificationDecision}</dd></div>}
        {document.humanVerifiedBy && <div><dt>Verified by</dt><dd>{document.humanVerifiedBy}</dd></div>}
        {document.humanVerifiedAt && <div><dt>Verified at</dt><dd>{new Date(document.humanVerifiedAt).toLocaleString()}</dd></div>}
        {document.humanVerificationNote && <div className="summary-grid__wide"><dt>Verification note</dt><dd>{document.humanVerificationNote}</dd></div>}
      </dl>
      {document.extractedText && <div className="officer-ocr-output"><strong>OCR-extracted information</strong><OcrTextDisplay text={document.extractedText} /></div>}
      {document.correctedExtractedData?.length ? (
        <div className="officer-ocr-output">
          <strong>Human-verified corrected information</strong>
          <dl className="summary-grid">{document.correctedExtractedData.map((field, index) => <div key={`${field.name}-${index}`}><dt>{field.name}</dt><dd>{field.value}</dd></div>)}</dl>
        </div>
      ) : null}
      {document.humanVerificationStatus === 'REJECTED' && <p className="muted">This document was rejected during human verification and is retained with the application.</p>}
      <button className="button button--quiet button--small" type="button" onClick={() => setShowOriginal((visible) => !visible)}>{showOriginal ? 'Hide original' : 'View private original'}</button>
      {loading && <LoadingState label="Loading authorized original…" />}
      {error && <ErrorState message={error} />}
      {showOriginal && originalUrl && (document.mimeType === 'application/pdf'
        ? <iframe className="document-preview" src={originalUrl} title={`Original document ${document.name}`} />
        : <img className="document-preview" src={originalUrl} alt={`Original document ${document.name}`} />)}
    </article>
  )
}

function OfficerApplicationQueuePage() {
  const currentTime = useCurrentTime()
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [deadlineOrder, setDeadlineOrder] = useState('ascending')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setApplications(await officerReviewService.listAssigned())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let current = true
    officerReviewService.listAssigned()
      .then((items) => { if (current) setApplications(items) })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Please try again.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const results = applications.filter((application) => {
      const matchesText = `${application.id} ${application.title} ${application.applicantName}`.toLowerCase().includes(query)
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'ASSIGNED' && application.status === 'ASSIGNED') ||
        (statusFilter === 'UNDER_REVIEW' && application.status === 'UNDER_REVIEW') ||
        (statusFilter === 'due-soon' && isDueSoon(application, currentTime)) ||
        (statusFilter === 'breached' && isBreached(application, currentTime))
      return matchesText && matchesStatus
    })
    return results.sort((left, right) => {
      const leftDeadline = left.deadlineAt ? new Date(left.deadlineAt).getTime() : Number.POSITIVE_INFINITY
      const rightDeadline = right.deadlineAt ? new Date(right.deadlineAt).getTime() : Number.POSITIVE_INFINITY
      return deadlineOrder === 'ascending' ? leftDeadline - rightDeadline : rightDeadline - leftDeadline
    })
  }, [applications, currentTime, deadlineOrder, search, statusFilter])

  const assignedCount = applications.filter((application) => application.status === 'ASSIGNED').length
  const reviewCount = applications.filter((application) => application.status === 'UNDER_REVIEW').length
  const dueSoonCount = applications.filter((application) => isDueSoon(application, currentTime)).length
  const breachedCount = applications.filter((application) => isBreached(application, currentTime)).length

  return (
    <DashboardLayout area="officer" title="Application queue">
      <PageHeader eyebrow="OFFICER WORKSPACE" title="Application queue" description="Review applications assigned to your Department. Prioritize upcoming deadlines and identify overdue work." />
      <div className="metric-grid">
        <MetricCard label="Assigned" value={loading || error ? '—' : assignedCount} detail="Awaiting explicit Start Review" icon="▤" />
        <MetricCard label="Under review" value={loading || error ? '—' : reviewCount} detail="Review explicitly started" icon="◷" />
        <MetricCard label="Due soon" value={loading || error ? '—' : dueSoonCount} detail="Within three days" icon="!" />
        <MetricCard label="Breached" value={loading || error ? '—' : breachedCount} detail="Deadline has passed" icon="!" />
      </div>
      <section className="panel">
        <div className="panel__heading panel__heading--wrap">
          <div><h2 className="panel__title">Assigned applications</h2><p className="muted">Search, filter or sort the queue by deadline.</p></div>
          <button className="button button--quiet button--small" onClick={() => void load()}>Refresh</button>
        </div>
        <div className="filter-row">
          <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search applications" placeholder="Search ID, title or applicant" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="filter-select"><span className="sr-only">Filter applications</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All assigned work</option><option value="ASSIGNED">Assigned</option><option value="UNDER_REVIEW">Under review</option><option value="due-soon">Due soon</option><option value="breached">Breached</option></select></label>
          <label className="filter-select"><span className="sr-only">Sort by deadline</span><select value={deadlineOrder} onChange={(event) => setDeadlineOrder(event.target.value)}><option value="ascending">Earliest deadline</option><option value="descending">Latest deadline</option></select></label>
        </div>
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : filtered.length ? <ApplicationTable applications={filtered} hrefFor={(application) => `/officer/applications/${application.id}`} /> : <EmptyState title="No matching applications" description="No review-ready applications match the current search or filters." />}
      </section>
    </DashboardLayout>
  )
}

export function OfficerDashboardPage() {
  const { user, status } = useAuth()

  if (status === 'loading') return <LoadingState label="Loading Officer workspace…" />
  if (user?.role === 'OFFICER') {
    if (user.mustChangePassword) return <Navigate to="/officer/change-password" replace />
    return <OfficerApplicationQueuePage />
  }
  if (status === 'authenticated') return <Navigate to="/officer/login" replace />
  return <Navigate to="/officer/login" replace />
}

export function OfficerApplicationDetailsPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [application, setApplication] = useState<ApplicationRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [loadedId, setLoadedId] = useState('')
  const [decisionDialog, setDecisionDialog] = useState<OfficerDecision | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setApplication(await officerReviewService.getApplication(id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Please try again.')
    } finally {
      setLoading(false)
      setLoadedId(id)
    }
  }

  useEffect(() => {
    let current = true
    officerReviewService.getApplication(id)
      .then((item) => { if (current) { setApplication(item); setError('') } })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Please try again.') })
      .finally(() => { if (current) { setLoadedId(id); setLoading(false) } })
    return () => { current = false }
  }, [id])

  async function startReview() {
    setBusy(true)
    setActionError('')
    try {
      setApplication(await officerReviewService.startReview(id))
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function decide() {
    if (!decisionDialog) return
    if (decisionDialog !== 'APPROVED' && !decisionReason.trim()) {
      setActionError('A reason is required to reject or escalate this application.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      await officerReviewService.decide(id, decisionDialog, decisionReason.trim())
      navigate('/officer')
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'The review decision could not be saved.')
      setBusy(false)
    }
  }

  const requiredReason = decisionDialog === 'REJECTED' || decisionDialog === 'ESCALATED'
  const decisionLabel: Record<OfficerDecision, string> = {
    APPROVED: 'Approve application',
    REJECTED: 'Reject application',
    ESCALATED: 'Escalate to General Officer',
  }
  const applicationStatus = application?.status as ApplicationStatus | undefined

  return (
    <DashboardLayout area="officer" title="Application details">
      <PageHeader eyebrow="ASSIGNED APPLICATION" title={application?.title ?? 'Application'} description={application?.id} action={<Link className="button button--secondary" to="/officer">← Application queue</Link>} />
      {loading || loadedId !== id ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : application && <>
        <div className="details-statusbar"><div><span className="muted">Current status</span><StatusBadge status={application.status} /></div><DeadlineIndicator deadlineAt={application.deadlineAt} breachedAt={application.breachedAt} /></div>
        {actionError && <p className="form-alert form-alert--error" role="alert">{actionError}</p>}
        <InfoCard title="Application and applicant information">
          <ApplicationSummary application={application} />
          <p className="application-description">{application.details}</p>
          <dl className="summary-grid"><div><dt>Applicant account</dt><dd>{application.applicant?.name || application.applicantName}</dd></div><div><dt>Applicant email</dt><dd>{application.applicant?.email || application.contactEmail}</dd></div><div><dt>Application type</dt><dd>{application.applicationType}</dd></div><div><dt>Department scope</dt><dd>{application.departmentId}</dd></div></dl>
        </InfoCard>
        <InfoCard title="Submitted documents">
          {application.documents.length ? <div className="officer-documents">{application.documents.map((document) => <OfficerDocumentCard key={document.id} document={document} />)}</div> : <p className="muted">No documents are attached to this application.</p>}
        </InfoCard>
        <InfoCard title="Officer review notes">
          {application.officerReview?.notes.length ? <dl className="review-notes">{application.officerReview.notes.map((entry, index) => <div key={`${entry.officerId}-${entry.at}-${index}`}><dt>{entry.action} · {entry.officerName} · {new Date(entry.at).toLocaleString()}</dt><dd>{entry.note || 'No additional note.'}</dd></div>)}</dl> : <p className="muted">No Officer review notes have been recorded.</p>}
        </InfoCard>
        <InfoCard title="Workflow timeline"><Timeline entries={application.timeline} /></InfoCard>
        <InfoCard title="Officer workflow">
          {applicationStatus === 'ASSIGNED' && <>
            <p className="muted">This case is assigned to your Department, but review has not started. Opening this page does not change its status.</p>
            <button className="button button--primary" type="button" onClick={() => void startReview()} disabled={busy}>{busy ? 'Starting review…' : 'Start Review'}</button>
          </>}
          {applicationStatus === 'UNDER_REVIEW' && <>
            <p className="muted">Record the Officer decision. Rejection and escalation require a reason.</p>
            <div className="verification-actions">
              <button className="button button--primary" type="button" disabled={busy} onClick={() => { setDecisionReason(''); setDecisionDialog('APPROVED') }}>Approve</button>
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => { setDecisionReason(''); setDecisionDialog('REJECTED') }}>Reject</button>
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => { setDecisionReason(''); setDecisionDialog('ESCALATED') }}>Escalate to General Officer</button>
            </div>
          </>}
        </InfoCard>
      </>}
      {decisionDialog && <ConfirmationDialog
        title={`${decisionLabel[decisionDialog]}?`}
        confirmLabel={decisionLabel[decisionDialog]}
        busy={busy}
        onCancel={() => { setDecisionDialog(null); setActionError('') }}
        onConfirm={() => void decide()}
      >
        <p>This decision is recorded against your authenticated Officer account.</p>
        <TextAreaField
          label={requiredReason ? 'Reason (required)' : 'Review note (optional)'}
          value={decisionReason}
          onChange={(event) => setDecisionReason(event.target.value)}
          rows={4}
          required={requiredReason}
        />
        {actionError && <p className="field__error" role="alert">{actionError}</p>}
      </ConfirmationDialog>}
    </DashboardLayout>
  )
}

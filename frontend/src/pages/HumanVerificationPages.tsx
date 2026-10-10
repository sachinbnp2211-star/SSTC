import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { DashboardLayout } from '../components/layout'
import { EmptyState, ErrorState, InfoCard, LoadingState, OcrTextDisplay, PageHeader } from '../components/ui'
import { humanVerificationService } from '../services/humanVerificationService'
import type {
  HumanVerificationApplication,
  HumanVerificationApplicationDocument,
  VerificationReason,
} from '../types'

const verificationStatuses = [
  ['PENDING', 'Pending Verification'],
  ['IN_REVIEW', 'In Review'],
  ['PASSED', 'Verified'],
  ['REJECTED', 'Rejected'],
] as const

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

function VerificationReasons({ reasons }: { reasons: VerificationReason[] }) {
  if (!reasons.length) return null
  return (
    <section aria-label="Human Verification required" className="verification-reasons">
      <h3>HUMAN VERIFICATION REQUIRED</h3>
      <h4>Why was this application sent for verification?</h4>
      <ol>
        {reasons.map((reason) => (
          <li key={`${reason.documentId}-${reason.code}`}>
            <strong>Document:</strong> {reason.documentName}
            <p><strong>Problem:</strong> {reason.message}</p>
            {reason.predictedDocumentType && <p><strong>Detected document type:</strong> {reason.predictedDocumentType}</p>}
            {reason.predictedDepartment && <p><strong>Predicted department:</strong> {reason.predictedDepartment}</p>}
            {reason.fieldNames?.length
              ? <p><strong>Fields requiring review:</strong> {reason.fieldNames.join(', ')}</p>
              : null}
            {reason.classificationConfidence !== null && reason.classificationConfidence !== undefined &&
              <p><strong>Classification confidence:</strong> {Math.round(reason.classificationConfidence * 100)}%</p>}
            {reason.qualityScore !== null && reason.qualityScore !== undefined &&
              <p><strong>Document quality score:</strong> {Math.round(reason.qualityScore * 100)}%</p>}
            {reason.fieldCompleteness !== null && reason.fieldCompleteness !== undefined &&
              <p><strong>Verified field completeness:</strong> {Math.round(reason.fieldCompleteness * 100)}%</p>}
            {reason.ocrNoiseScore !== null && reason.ocrNoiseScore !== undefined &&
              <p><strong>AI-estimated OCR noise:</strong> {Math.round(reason.ocrNoiseScore * 100)}%</p>}
            {reason.failureCode && <p><strong>Failure Code:</strong> {reason.failureCode}</p>}
            {reason.failureDescription && <p><strong>Failure Details:</strong> {reason.failureDescription}</p>}
            <p><strong>Action:</strong> {reason.action}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function HumanVerificationDashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [applications, setApplications] = useState<Omit<HumanVerificationApplication, 'applicationData' | 'documents'>[]>([])
  const [statusFilter, setStatusFilter] = useState<(typeof verificationStatuses)[number][0]>('PENDING')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [startingReviewId, setStartingReviewId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setApplications(await humanVerificationService.listApplications('ALL'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Human Verification queue could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let current = true
    humanVerificationService.listApplications('ALL')
      .then((items) => { if (current) setApplications(items) })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'The Human Verification queue could not be loaded.')
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  async function openReview(application: Pick<HumanVerificationApplication, 'id' | 'humanVerificationStatus'>) {
    setStartingReviewId(application.id)
    setError('')
    try {
      if (application.humanVerificationStatus === 'PENDING') {
        await humanVerificationService.startApplicationReview(application.id)
      }
      navigate(`/human-verifier/review/${application.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The review could not be started.')
    } finally {
      setStartingReviewId(null)
    }
  }

  const filtered = applications.filter((application) =>
    application.humanVerificationStatus === statusFilter,
  )

  return (
    <DashboardLayout area="human-verifier" title="Human Verifier Officer dashboard">
      <PageHeader
        eyebrow="HUMAN VERIFIER OFFICER"
        title="Human Verification Dashboard"
        description="Review applications held because document OCR/validation failed or automatic processing requires human review."
      />
      <InfoCard title="System-wide verification role">
        <p className="muted">You are signed in as a Human Verifier Officer. Your role is system-wide and is not assigned to a Department. Review decisions and routing are validated and audited by the backend.</p>
      </InfoCard>
      {location.state && typeof location.state === 'object' && 'message' in location.state && (
        <p className="form-alert" role="status">{String(location.state.message)}</p>
      )}
      <section className="panel">
        <div className="panel__heading">
          <div>
            <h2 className="panel__title">{verificationStatuses.find(([status]) => status === statusFilter)?.[1]}</h2>
            <p className="muted">Applications are reviewed as a whole. You select only the Department on PASS; the backend handles officer assignment.</p>
          </div>
          <button className="button button--quiet button--small" type="button" onClick={() => void load()}>Refresh</button>
        </div>
        <div className="verification-actions" role="tablist" aria-label="Human Verification status">
          {verificationStatuses.map(([status, label]) => (
            <button
              key={status}
              className={`button ${statusFilter === status ? 'button--primary' : 'button--secondary'}`}
              type="button"
              role="tab"
              aria-selected={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            >
              {label} ({applications.filter((item) => item.humanVerificationStatus === status).length})
            </button>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <LoadingState /> : filtered.length ? (
          <div className="verification-list">
            {filtered.map((application) => (
              <article className="verification-list__item" key={application.id}>
                <div>
                  <p className="eyebrow">{application.applicationId} · {application.applicationType}</p>
                  <h3>{application.applicantName} · {application.title}</h3>
                  <p className="muted">
                    {application.documentCount} document(s) · {application.verificationReasons?.map(({ documentName, message }) => `${documentName}: ${message}`).join(' ') || application.reason || 'Reason details were not recorded for this application.'} · Submitted {formatDate(application.submittedAt)}
                  </p>
                </div>
                {['PENDING', 'IN_REVIEW'].includes(application.humanVerificationStatus) ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={startingReviewId === application.id}
                    onClick={() => void openReview(application)}
                  >
                    {startingReviewId === application.id
                      ? 'Opening…'
                      : application.humanVerificationStatus === 'PENDING' ? 'Start Review' : 'Continue Review'}
                  </button>
                ) : <span className="admin-registration-status">{application.humanVerificationStatus}</span>}
              </article>
            ))}
          </div>
        ) : !error && (
          <EmptyState
            title={`No ${verificationStatuses.find(([status]) => status === statusFilter)?.[1].toLowerCase()} applications`}
            description="No applications currently have this Human Verification status."
          />
        )}
      </section>
    </DashboardLayout>
  )
}

function OriginalDocument({ document }: { document: HumanVerificationApplicationDocument }) {
  const [show, setShow] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    let objectUrl = ''
    if (show) {
      humanVerificationService.getOriginalDocument(document.id)
        .then((blob) => {
          if (!current) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        })
        .catch((reason: unknown) => {
          if (current) setError(reason instanceof Error ? reason.message : 'The original document could not be loaded.')
        })
        .finally(() => { if (current) setLoading(false) })
    }
    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [document.id, show])

  return (
    <InfoCard title={`${document.documentType} · ${document.filename}`}>
      <dl className="summary-grid">
        <div><dt>Document review</dt><dd>{document.ocrStatus === 'LOW_CONFIDENCE' ? 'Verification pending' : document.ocrStatus}</dd></div>
        <div><dt>Uploaded</dt><dd>{formatDate(document.submittedAt)}</dd></div>
      </dl>
      {document.humanVerificationReason && <p>{document.humanVerificationReason}</p>}
      <h3>OCR-extracted information</h3>
      <OcrTextDisplay text={document.extractedText} />
      {document.extractedText && (
        <details className="ocr-raw-details">
          <summary>Show raw OCR text</summary>
          <pre className="verification-extracted-text">{document.extractedText}</pre>
        </details>
      )}
      <button
        className="button button--secondary"
        type="button"
        onClick={() => {
          setError('')
          setLoading(!show)
          if (show) setUrl('')
          setShow((value) => !value)
        }}
      >
        {show ? 'Hide original document' : 'View original document'}
      </button>
      {loading && <LoadingState label="Loading private original…" />}
      {error && <ErrorState message={error} />}
      {show && url && (document.mimeType === 'application/pdf'
        ? <iframe className="document-preview" src={url} title={`Original ${document.filename}`} />
        : <img className="document-preview" src={url} alt={`Original ${document.filename}`} />)}
    </InfoCard>
  )
}

export function HumanVerificationDetailsPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [application, setApplication] = useState<HumanVerificationApplication | null>(null)
  const [departments, setDepartments] = useState<{ id: string; name: string; code: string }[]>([])
  const [decision, setDecision] = useState<'PASS' | 'REJECT' | null>(null)
  const [departmentId, setDepartmentId] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    humanVerificationService.getApplication(id)
      .then((result) => { if (current) setApplication(result) })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'Application review could not be loaded.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [id])

  async function startReview() {
    setSaving(true)
    setError('')
    try {
      await humanVerificationService.startApplicationReview(id)
      setApplication((current) => current
        ? { ...current, humanVerificationStatus: 'IN_REVIEW' }
        : current)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The review could not be started.')
    } finally {
      setSaving(false)
    }
  }

  async function chooseDecision(value: 'PASS' | 'REJECT') {
    setDecision(value)
    setDepartmentId('')
    setError('')
    if (value === 'PASS') {
      try {
        setDepartments(await humanVerificationService.listDepartments())
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The Department list could not be loaded.')
      }
    }
  }

  async function submitDecision() {
    if (!decision) return
    if (decision === 'REJECT' && !reason.trim()) {
      setError('A rejection reason is required.')
      return
    }
    if (decision === 'PASS' && !departmentId) {
      setError('Select the concerned Department before passing the application.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await humanVerificationService.decideApplication(id, decision, reason, departmentId || undefined)
      navigate('/human-verifier', {
        replace: true,
        state: { message: decision === 'PASS'
          ? response.result.status === 'ASSIGNED'
            ? `Application routed to ${response.result.department?.name} and assigned for Officer processing.`
            : `Application routed to ${response.result.department?.name}; it is waiting for an eligible Officer.`
          : 'Application rejected. The rejection reason is recorded on the application.' },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The decision could not be saved.')
      setSaving(false)
    }
  }

  return (
    <DashboardLayout area="human-verifier" title="Human Verifier Officer review">
      <PageHeader
        eyebrow="APPLICATION HUMAN VERIFICATION"
        title={application?.title || 'Application review'}
        description={application ? `${application.applicantName} · ${application.applicationId} · ${application.applicationType}` : 'Review the application and its uploaded evidence.'}
        action={<Link className="button button--secondary" to="/human-verifier">← Verification queue</Link>}
      />
      {loading ? <LoadingState /> : error && !application
        ? <ErrorState message={error} />
        : application && (
          <>
            <InfoCard title="Application and applicant">
              <dl className="summary-grid">
                <div><dt>Application ID</dt><dd>{application.applicationId}</dd></div>
                <div><dt>Applicant</dt><dd>{application.applicationData?.applicantName || application.applicantName}</dd></div>
                <div><dt>Contact email</dt><dd>{application.applicationData?.contactEmail || '—'}</dd></div>
                <div><dt>Application type</dt><dd>{application.applicationType}</dd></div>
                <div><dt>Current application status</dt><dd>{application.status}</dd></div>
                <div><dt>Verification status</dt><dd>{application.humanVerificationStatus}</dd></div>
                <div><dt>Submitted</dt><dd>{formatDate(application.submittedAt)}</dd></div>
              </dl>
              <h3>Application details</h3>
              <p>{application.applicationData?.details || '—'}</p>
              <VerificationReasons reasons={application.verificationReasons || []} />
              {!(application.verificationReasons?.length) && <>
                <h3>Reason for Human Verification</h3>
                <p>{application.humanVerificationReason || application.reason || 'Reason details were not recorded when this application entered Human Verification.'}</p>
              </>}
              {application.humanVerificationRejectionReason && <p><strong>Rejection reason:</strong> {application.humanVerificationRejectionReason}</p>}
            </InfoCard>
            {application.documents.map((document) => <OriginalDocument document={document} key={document.id} />)}
            {['PENDING', 'IN_REVIEW'].includes(application.humanVerificationStatus) ? (
              <InfoCard title="Human Verification decision">
                {application.humanVerificationStatus === 'PENDING'
                  ? <button className="button button--primary" type="button" disabled={saving} onClick={() => void startReview()}>{saving ? 'Starting…' : 'Start Review'}</button>
                  : <>
                    <p>PASS routes directly to the Department you select below. OCR and automatic department determination will not be rerun.</p>
                    <div className="verification-actions">
                      <button className={`button ${decision === 'PASS' ? 'button--primary' : 'button--secondary'}`} type="button" onClick={() => void chooseDecision('PASS')}>PASS</button>
                      <button className={`button ${decision === 'REJECT' ? 'button--primary' : 'button--secondary'}`} type="button" onClick={() => void chooseDecision('REJECT')}>REJECT</button>
                    </div>
                    {decision === 'PASS' && (
                      <label className="field">
                        <span className="field-label">Concerned Department</span>
                        <select className="field-input" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required>
                          <option value="" disabled>Choose a Department</option>
                          {departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}
                        </select>
                      </label>
                    )}
                    {decision === 'REJECT' && <p className="muted">A rejection reason is required. Rejected applications do not enter Department assignment.</p>}
                    {decision && (
                      <label className="field">
                        <span className="field-label">{decision === 'REJECT' ? 'Rejection reason' : 'Review note (optional)'}</span>
                        <textarea className="field-input verification-note" maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} required={decision === 'REJECT'} />
                      </label>
                    )}
                    {error && <p className="form-error" role="alert">{error}</p>}
                    {decision && <button className="button button--primary" type="button" disabled={saving} onClick={() => void submitDecision()}>{saving ? 'Saving…' : decision === 'PASS' ? 'Route Application' : 'Reject Application'}</button>}
                  </>}
              </InfoCard>
            ) : (
              <InfoCard title="Human Verification completed">
                <p>This application has already received a Human Verification decision and cannot be changed here.</p>
              </InfoCard>
            )}
          </>
        )}
    </DashboardLayout>
  )
}

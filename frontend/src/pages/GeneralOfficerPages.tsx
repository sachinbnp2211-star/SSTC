import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DashboardLayout } from '../components/layout'
import {
  ApplicationSummary,
  ApplicationTable,
  EmptyState,
  ErrorState,
  InfoCard,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui'
import { generalOfficerReviewService } from '../services/generalOfficerReviewService'
import type { ApplicationRecord } from '../types'

export function GeneralOfficerSubmissionPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [receipt, setReceipt] = useState<{
    applicationType: string
    applicationId: string
    applicantName: string
  } | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedFile) {
      setError('Choose a document to upload.')
      return
    }
    setBusy(true)
    setError('')
    setReceipt(null)
    const form = new FormData()
    form.set('file', selectedFile)
    try {
      const result = await generalOfficerReviewService.submitApplication(form)
      setReceipt(result.receipt)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The application could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  function acceptFiles(files: FileList | null) {
    const file = files?.[0]
    if (file) {
      setSelectedFile(file)
      setError('')
      setReceipt(null)
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    acceptFiles(event.dataTransfer.files)
  }

  return (
    <DashboardLayout area="general-officer" title="Submit application">
      <PageHeader eyebrow="GENERAL OFFICER WORKSPACE" title="Submit an application" description="Upload an applicant’s document for processing." />
      {error && <ErrorState message={error} />}
      {receipt ? (
        <section className="submission-receipt" aria-labelledby="submission-receipt-title">
          <div className="submission-receipt__seal" aria-hidden="true">✓</div>
          <p className="eyebrow">GOVERNMENT OF HACKBIOS · SUBMISSION RECEIPT</p>
          <h2 id="submission-receipt-title">Application received</h2>
          <p className="muted">Keep this receipt. Use the Application ID to track processing progress.</p>
          <dl className="submission-receipt__details">
            <div><dt>Application Type</dt><dd>{receipt.applicationType}</dd></div>
            {receipt.applicationId && <div><dt>Application ID</dt><dd>{receipt.applicationId}</dd></div>}
            <div><dt>Applicant Name</dt><dd>{receipt.applicantName}</dd></div>
          </dl>
          <div className="form-actions">
            <Link className="button button--primary" to={`/general-officer/submissions/${encodeURIComponent(receipt.applicationId)}`}>Track application</Link>
            <Link className="button button--secondary" to="/general-officer">Return to workspace</Link>
          </div>
        </section>
      ) : (
        <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
          <label
            className={`applicant-dropzone${dragging ? ' applicant-dropzone--active' : ''}`}
            htmlFor="general-application-file"
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="applicant-dropzone__icon" aria-hidden="true">↑</span>
            <strong>{selectedFile ? 'Document selected' : 'Drag and drop a document here'}</strong>
            <span>{selectedFile ? selectedFile.name : 'or choose a file to upload'}</span>
            <small>Accepted formats: PDF, PNG, JPEG.</small>
            <input
              className="applicant-dropzone__input"
              id="general-application-file"
              ref={fileInput}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={(event) => acceptFiles(event.currentTarget.files)}
            />
          </label>
          <div className="form-actions">
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Choose document</button>
            <button className="button button--primary" type="submit" disabled={busy || !selectedFile}>{busy ? 'Uploading and processing…' : 'Upload document'}</button>
            {selectedFile && <button className="button button--quiet button--small" type="button" disabled={busy} onClick={() => setSelectedFile(null)}>Remove</button>}
          </div>
        </form>
      )}
    </DashboardLayout>
  )
}

export function GeneralOfficerSubmissionDetailsPage() {
  const { id = '' } = useParams()
  const [application, setApplication] = useState<ApplicationRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    generalOfficerReviewService.getSubmission(id)
      .then((record) => { if (current) setApplication(record) })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Submission details could not be loaded.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [id])

  return (
    <DashboardLayout area="general-officer" title="Track submission">
      <PageHeader eyebrow="APPLICATION TRACKING" title="Submission details" description="Track the persisted application using its Application ID." />
      {loading ? <LoadingState label="Loading application…" /> : error ? <ErrorState message={error} /> : application && (
        <section className="panel form-panel">
          <ApplicationSummary application={application} />
          <div className="form-alert" role="status">Current processing status: <StatusBadge status={application.status} /></div>
          <InfoCard title="Application ID"><p>{application.id}</p></InfoCard>
          <Link className="button button--secondary" to="/general-officer">Return to workspace</Link>
        </section>
      )}
    </DashboardLayout>
  )
}

export function GeneralOfficerTrackingPage() {
  const [submissions, setSubmissions] = useState<ApplicationRecord[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    generalOfficerReviewService.getDashboard(search)
      .then((dashboard) => {
        if (!current) return
        setSubmissions(dashboard.submissions)
      })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Please try again.') })
      .finally(() => { if (current) setLoading(false) })
    return () => {
      current = false
    }
  }, [search, refreshCount])

  return (
    <DashboardLayout area="general-officer" title="Track applications">
      <PageHeader eyebrow="GENERAL OFFICER WORKSPACE" title="Track applications" description="Search applications by applicant name or ID, Application ID, application type, or text read from the document." />
      <section className="panel">
        <div className="panel__heading">
          <div><h2 className="panel__title">Application tracking</h2><p className="muted">Search your submissions by applicant name or ID, Application ID, and application type.</p></div>
          <button className="button button--quiet button--small" type="button" onClick={() => { setLoading(true); setError(''); setRefreshCount((count) => count + 1) }}>Refresh</button>
        </div>
        <form className="filter-row general-officer-search" onSubmit={(event) => { event.preventDefault(); setLoading(true); setError(''); setSearch(searchInput.trim()); setRefreshCount((count) => count + 1) }}>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="Search by applicant name or ID, Application ID, or application type"
              placeholder="Applicant name or ID, Application ID, or application type"
              value={searchInput}
              maxLength={160}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <button className="button button--primary" type="submit">Search</button>
          {search && <button className="button button--quiet" type="button" onClick={() => { setSearchInput(''); setLoading(true); setError(''); setSearch(''); setRefreshCount((count) => count + 1) }}>Clear</button>}
        </form>
        {loading ? <LoadingState label="Loading applications…" /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); setRefreshCount((count) => count + 1) }} /> : <>
          {submissions.length
            ? <ApplicationTable applications={submissions} hrefFor={(application) => `/general-officer/submissions/${application.id}`} />
            : <EmptyState title={search ? 'No matching applications' : 'No applications submitted yet'} description={search ? 'Try another applicant name or ID, Application ID, or application type.' : 'Applications submitted from this General Officer account will appear here.'} />}
        </>}
      </section>
    </DashboardLayout>
  )
}

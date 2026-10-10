import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { DashboardLayout } from '../components/layout'
import {
  ApplicationSummary,
  ApplicationTable,
  DeadlineIndicator,
  DocumentList,
  EmptyState,
  ErrorState,
  InfoCard,
  LoadingState,
  MetricCard,
  NotificationPanel,
  PageHeader,
  StatusBadge,
  Timeline,
} from '../components/ui'
import { applicationService } from '../services/applicationService'
import { notificationService } from '../services/notificationService'
import { DocumentUploadError, documentService } from '../services/documentService'
import { askChatbot, type ChatReply } from '../services/chatService'
import type { ApplicationDraft, ApplicationRecord } from '../types'

const defaultApplicantService = 'Income Certificate'

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDocumentStatus(status: string, requiresVerification: boolean) {
  if (requiresVerification || status === 'LOW_CONFIDENCE') return 'additional verification required'
  return status.toLowerCase().replaceAll('_', ' ')
}

export function ApplicantDashboardPage() {
  const { user } = useAuth()
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [uploadApplicationId, setUploadApplicationId] = useState('')
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadingDashboardFiles, setUploadingDashboardFiles] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [dashboardUploadError, setDashboardUploadError] = useState('')
  const [dashboardUploadStatus, setDashboardUploadStatus] = useState('')
  const dashboardFileInput = useRef<HTMLInputElement>(null)
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof notificationService.listApplicantNotifications>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notificationsLoading, setNotificationsLoading] = useState(true)
  const [notificationsError, setNotificationsError] = useState('')
  async function load() {
    setLoading(true)
    setError('')
    try {
      const nextApplications = await applicationService.listForApplicant()
      setApplications(nextApplications)
      setUploadApplicationId((current) => (
        nextApplications.some((application) => application.id === current && application.status === 'DRAFT')
          ? current
          : nextApplications.find((application) => application.status === 'DRAFT')?.id || ''
      ))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Please try again.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let current = true
    applicationService.listForApplicant()
      .then((items) => {
        if (current) {
          setApplications(items)
          setUploadApplicationId(items.find((application) => application.status === 'DRAFT')?.id || '')
        }
      })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Please try again.') })
      .finally(() => { if (current) setLoading(false) })
    notificationService.listApplicantNotifications()
      .then((items) => { if (current) setNotifications(items) })
      .catch((reason: unknown) => { if (current) setNotificationsError(reason instanceof Error ? reason.message : 'Please try again.') })
      .finally(() => { if (current) setNotificationsLoading(false) })
    return () => { current = false }
  }, [])

  function addUploadFiles(files: FileList | File[]) {
    setUploadFiles((current) => {
      const incoming = Array.from(files)
      const currentKeys = new Set(current.map((file) => `${file.name}-${file.size}-${file.lastModified}`))
      return [...current, ...incoming.filter((file) => !currentKeys.has(`${file.name}-${file.size}-${file.lastModified}`))]
    })
    setDashboardUploadError('')
    setDashboardUploadStatus('')
  }

  async function uploadDashboardDocuments() {
    if (!uploadApplicationId) {
      setDashboardUploadError('Create or select a draft application before uploading documents.')
      return
    }
    if (uploadFiles.length === 0) {
      setDashboardUploadError('Select or drop at least one supporting document.')
      return
    }

    const selectedApplication = applications.find((application) => application.id === uploadApplicationId)
    if (!selectedApplication || selectedApplication.status !== 'DRAFT') {
      setDashboardUploadError('Documents can only be added to one of your draft applications.')
      return
    }

    setUploadingDashboardFiles(true)
    setDashboardUploadError('')
    setDashboardUploadStatus('')
    const remainingFiles: File[] = []
    const messages: string[] = []
    for (const file of uploadFiles) {
      try {
        const document = await documentService.uploadForApplicant(uploadApplicationId, file)
        messages.push(`${file.name}: Document ${formatDocumentStatus(document.status, document.humanVerificationRequired)}.`)
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : 'The document could not be uploaded.'
        if (reason instanceof DocumentUploadError && reason.status === 422) {
          messages.push(`${file.name}: stored successfully, but OCR processing failed. ${detail}`)
        } else {
          messages.push(`${file.name}: ${detail}`)
          remainingFiles.push(file)
        }
      }
    }
    setUploadFiles(remainingFiles)
    setDashboardUploadStatus(messages.join(' '))
    try {
      const refreshedApplications = await applicationService.listForApplicant()
      setApplications(refreshedApplications)
    } catch (reason) {
      setDashboardUploadError(reason instanceof Error ? reason.message : 'Document processing completed, but application status could not be refreshed.')
    } finally {
      setUploadingDashboardFiles(false)
    }
  }

  const activeCount = applications.filter((application) => application.status !== 'APPROVED' && application.status !== 'REJECTED').length
  const decisionCount = applications.filter((application) => application.status === 'APPROVED' || application.status === 'REJECTED').length
  const selectedUploadApplication = applications.find((application) => application.id === uploadApplicationId)
  return (
    <DashboardLayout area="applicant" title="My applications">
      <PageHeader eyebrow="APPLICANT PORTAL" title="Dashboard" description={`Welcome back, ${user?.displayName || 'applicant'}. Here is where your applications stand.`} action={<div className="applicant-header-actions"><details className="profile-menu"><summary>{user?.displayName || 'Applicant'} ⌄</summary><div className="profile-menu__content"><strong>{user?.displayName}</strong><span>{user?.email}</span><Link to="/applicant/profile">View profile</Link></div></details><Link className="button button--primary" to="/applicant/applications/new">Apply for service</Link></div>} />
      <div className="metric-grid metric-grid--three"><MetricCard label="Applications" value={loading || error ? '—' : applications.length} detail="Saved to your account" icon="▤" /><MetricCard label="Open applications" value={loading || error ? '—' : activeCount} detail="Not in a recorded decision state" icon="◷" /><MetricCard label="Recorded decisions" value={loading || error ? '—' : decisionCount} detail="Approved or rejected status" icon="✓" /></div>
      <section className="panel applicant-upload-panel">
        <div className="panel__heading"><div><h2 className="panel__title">Upload supporting documents</h2><p className="muted">Add PDF, PNG or JPEG documents to one of your draft applications.</p></div></div>
        {applications.some((application) => application.status === 'DRAFT') ? <>
          <div className="field applicant-upload-panel__application">
            <label htmlFor="dashboard-upload-application">Draft application</label>
            <select id="dashboard-upload-application" value={uploadApplicationId} disabled={uploadingDashboardFiles}
              onChange={(event) => setUploadApplicationId(event.target.value)}>
              {applications.filter((application) => application.status === 'DRAFT').map((application) => (
                <option key={application.id} value={application.id}>{application.title} · {application.applicationType}</option>
              ))}
            </select>
          </div>
          <div
            className={`applicant-dropzone${draggingFiles ? ' applicant-dropzone--active' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDraggingFiles(true) }}
            onDragOver={(event) => { event.preventDefault(); setDraggingFiles(true) }}
            onDragLeave={(event) => { event.preventDefault(); setDraggingFiles(false) }}
            onDrop={(event) => { event.preventDefault(); setDraggingFiles(false); addUploadFiles(event.dataTransfer.files) }}
          >
            <span className="applicant-dropzone__icon" aria-hidden="true">↑</span>
            <strong>Drag and drop documents here</strong>
            <span>or select a document from your device</span>
            <button className="button button--secondary button--small" type="button" disabled={uploadingDashboardFiles}
              onClick={() => dashboardFileInput.current?.click()}>Upload Document</button>
            <input ref={dashboardFileInput} id="dashboard-document-upload" className="applicant-dropzone__input" type="file" multiple
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={uploadingDashboardFiles}
              onChange={(event) => { if (event.currentTarget.files) addUploadFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
            <small>PDF, PNG or JPEG. The service validates file types and size before securely processing uploads.</small>
          </div>
          {uploadFiles.length > 0 && <ul className="applicant-upload-files" aria-label="Selected files">
            {uploadFiles.map((file, index) => (
              <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                <span>{file.name}</span><small>{file.type || 'File'} · {formatFileSize(file.size)}</small>
                <button className="button button--quiet button--small" type="button" disabled={uploadingDashboardFiles}
                  aria-label={`Remove ${file.name}`} onClick={() => setUploadFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
              </li>
            ))}
          </ul>}
          <div className="form-actions applicant-upload-panel__actions">
            <button className="button button--primary" type="button" disabled={uploadingDashboardFiles || uploadFiles.length === 0}
              onClick={() => void uploadDashboardDocuments()}>{uploadingDashboardFiles ? 'Uploading and processing…' : 'Upload selected files'}</button>
            {uploadFiles.length > 0 && <button className="button button--quiet" type="button" disabled={uploadingDashboardFiles}
              onClick={() => { setUploadFiles([]); setDashboardUploadError(''); setDashboardUploadStatus('') }}>Cancel selection</button>}
          </div>
          {dashboardUploadStatus && <div className="form-alert" role="status">{dashboardUploadStatus}</div>}
          {dashboardUploadError && <div className="form-alert form-alert--error" role="alert">{dashboardUploadError}</div>}
          {selectedUploadApplication?.documents.length ? <InfoCard title={`Documents for ${selectedUploadApplication.title}`}>
            <DocumentList documents={selectedUploadApplication.documents} />
          </InfoCard> : null}
        </> : <EmptyState title="No draft applications" description="Create an application before adding supporting documents." action={<Link className="button button--primary" to="/applicant/applications/new">Create application</Link>} />}
      </section>
      <section className="panel">
        <div className="panel__heading"><div><h2 className="panel__title">Recent applications</h2><p className="muted">Your records only • Sample data</p></div><button className="button button--quiet button--small" onClick={() => void load()}>Refresh</button></div>
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : applications.length ? <ApplicationTable applications={applications} hrefFor={(application) => `/applicant/applications/${application.id}`} /> : <EmptyState title="No applications yet" description="Start a new application when you are ready." action={<Link className="button button--primary" to="/applicant/applications/new">Upload application</Link>} />}
      </section>
      {notificationsLoading ? <LoadingState label="Loading notifications…" /> : notificationsError ? <ErrorState message={notificationsError} /> : <NotificationPanel notifications={notifications} />}
    </DashboardLayout>
  )
}

export function ApplicantApplicationsPage() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setApplications(await applicationService.listForApplicant())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Applications could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <DashboardLayout area="applicant" title="My applications">
      <PageHeader eyebrow="MY APPLICATIONS" title="Your applications" description="View every application, its current status, and the next action." action={<Link className="button button--primary" to="/applicant/applications/new">Apply for service</Link>} />
      <section className="panel">
        <div className="panel__heading"><div><h2 className="panel__title">Application history</h2><p className="muted">Your records only • Status updates appear here.</p></div><button className="button button--quiet button--small" type="button" onClick={() => void load()}>Refresh</button></div>
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : <ApplicationTable applications={applications} hrefFor={(application) => `/applicant/applications/${application.id}`} />}
      </section>
    </DashboardLayout>
  )
}

export function ApplicantProfilePage() {
  const { user } = useAuth()
  return (
    <DashboardLayout area="applicant" title="Profile">
      <PageHeader eyebrow="PROFILE" title="Your profile" description="Review the account details used when you submit an application." />
      <InfoCard title="Account information">
        <dl className="summary-grid applicant-profile-grid">
          <div><dt>Name</dt><dd>{user?.displayName || '—'}</dd></div>
          <div><dt>Email address</dt><dd>{user?.email || '—'}</dd></div>
          <div><dt>Account type</dt><dd>Applicant</dd></div>
          <div><dt>Account status</dt><dd>{user?.accountStatus || 'Active'}</dd></div>
        </dl>
        <p className="muted">To update account information or reset your password, use the account support process.</p>
      </InfoCard>
    </DashboardLayout>
  )
}

export function ApplicantHelpPage() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string; warning?: string }>>([
    { role: 'assistant', text: 'Welcome. I can explain registration, document submission, OCR errors, department routing, human verification, and application statuses.' },
  ])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const suggestions = ['How do I register?', 'Why did my document need human verification?', 'Where can I see my application status?']

  async function sendQuestion(value = question) {
    const trimmed = value.trim()
    if (!trimmed || chatLoading) return
    setMessages((current) => [...current, { role: 'user', text: trimmed }])
    setQuestion('')
    setChatError('')
    setChatLoading(true)
    try {
      const reply: ChatReply = await askChatbot(trimmed)
      setMessages((current) => [...current, { role: 'assistant', text: reply.message, warning: reply.warning }])
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : 'The support assistant could not respond.')
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <DashboardLayout area="applicant" title="Help & Support">
      <PageHeader eyebrow="HELP & SUPPORT" title="How can we help?" description="Guidance for submitting documents and following an application." />
      <section className="panel help-chat-panel" aria-labelledby="help-chat-title">
        <div className="panel__heading">
          <div><p className="eyebrow">AI SUPPORT ASSISTANT</p><h2 className="panel__title" id="help-chat-title">Ask about HacKBios</h2><p className="muted">Answers use verified project guidance. The assistant cannot access or change your application.</p></div>
          <Link className="button button--secondary button--small" to="/applicant/help#human-support">Human support</Link>
        </div>
        <div className="help-chat__suggestions">{suggestions.map((suggestion) => <button type="button" className="help-chat__suggestion" key={suggestion} onClick={() => void sendQuestion(suggestion)}>{suggestion}</button>)}</div>
        <div className="help-chat__messages" aria-live="polite">
          {messages.map((message, index) => <div className={`help-chat__message help-chat__message--${message.role}`} key={`${message.role}-${index}`}><span>{message.text}</span>{message.warning && <small>{message.warning}</small>}</div>)}
          {chatLoading && <div className="help-chat__message help-chat__message--assistant"><span className="help-chat__loading">Thinking<span>.</span><span>.</span><span>.</span></span></div>}
        </div>
        {chatError && <div className="error-state help-chat__error" role="alert"><span>{chatError}</span><button type="button" className="text-button" onClick={() => void sendQuestion()}>Retry</button></div>}
        <form className="help-chat__form" onSubmit={(event) => { event.preventDefault(); void sendQuestion() }}>
          <label className="sr-only" htmlFor="help-chat-question">Ask a support question</label>
          <input id="help-chat-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1200} placeholder="Ask how registration, OCR, or application status works..." />
          <button className="button button--primary" type="submit" disabled={chatLoading || !question.trim()}>Send</button>
        </form>
        <p className="help-chat__privacy">For your security, never share passwords, OTPs, session tokens, identity numbers, or complete uploaded documents.</p>
      </section>
      <section className="applicant-help-grid">
        <InfoCard title="Basic questions and answers">
          <details open><summary>How do I start?</summary><p>Choose Apply for Service, select the service, upload the requested documents, and review before submitting.</p></details>
          <details><summary>How do I register?</summary><p>Open Applicant registration, enter your display name, email, and password, then sign in to the Applicant Portal.</p></details>
          <details><summary>What documents can I upload?</summary><p>PDF, PNG, and JPEG files are accepted. Use clear, complete copies and check the document list before submission.</p></details>
          <details><summary>Why did OCR or human verification appear?</summary><p>OCR provides extraction suggestions. If text or required fields are unclear or incomplete, an authorized verifier may need to compare the document with the original.</p></details>
        </InfoCard>
        <InfoCard title="Tracking and review">
          <details open><summary>Where can I see progress?</summary><p>Open My Applications and choose View details to see the recorded status, timeline, documents, and next action.</p></details>
          <details><summary>How is my application routed?</summary><p>Applications are routed to the relevant department using the submitted application type and the configured department workflow.</p></details>
          <details><summary>Can the chatbot see my application?</summary><p>No. The chatbot explains the website workflow but cannot access or change private application records.</p></details>
        </InfoCard>
      </section>
      <section className="panel help-human-support" id="human-support">
        <div className="panel__heading"><div><h2 className="panel__title">Need a person?</h2><p className="muted">If the assistant cannot answer your question or you need account-specific help, use the human-support process provided by your service team. Do not share passwords, OTPs, or session tokens.</p></div></div>
      </section>
    </DashboardLayout>
  )
}

export function CreateApplicationPage() {
  const { user } = useAuth()
  const [application, setApplication] = useState<ApplicationRecord | null>(null)
  const selectedService = defaultApplicantService
  const [step, setStep] = useState<'upload' | 'review' | 'complete'>('upload')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function uploadDocuments() {
    if (selectedFiles.length === 0) {
      setError('Select or drop at least one supporting document.')
      return
    }
    const applicant = user
    if (!application && (!applicant?.displayName || !applicant.email)) {
      setError('Your applicant profile is missing required contact information. Update your profile or contact support.')
      return
    }

    setUploading(true)
    setUploadStatus('')
    setError('')
    const remaining: File[] = []
    const messages: string[] = []
    let targetApplication = application
    try {
      if (!targetApplication) {
        const title = selectedService
        const applicantName = applicant?.displayName
        const contactEmail = applicant?.email
        if (!applicantName || !contactEmail) {
          throw new Error('Your applicant profile is missing required contact information. Update your profile or contact support.')
        }
        const applicationDraft: ApplicationDraft = {
          applicationType: selectedService,
          title,
          applicantName,
          contactEmail,
          details: 'Supporting document submitted for government service review.',
        }
        targetApplication = await applicationService.create(applicationDraft)
        setApplication(targetApplication)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The application could not be prepared for upload.')
      setUploading(false)
      return
    }

    for (const file of selectedFiles) {
      try {
        const document = await documentService.uploadForApplicant(targetApplication.id, file)
        messages.push(`${file.name}: Document ${formatDocumentStatus(document.status, document.humanVerificationRequired)}.`)
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Upload failed.'
        messages.push(`${file.name}: ${message}`)
        if (!(reason instanceof DocumentUploadError && reason.status === 422)) {
          remaining.push(file)
        }
      }
    }
    setSelectedFiles(remaining)
    setUploadStatus(messages.join(' '))
    try {
      const refreshed = await applicationService.getForApplicant(targetApplication.id)
      setApplication(refreshed)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Document status could not be refreshed.')
    } finally {
      setUploading(false)
    }
  }

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files)
    setSelectedFiles((current) => {
      const existing = new Set(current.map((file) => `${file.name}-${file.size}-${file.lastModified}`))
      return [...current, ...incoming.filter((file) => !existing.has(`${file.name}-${file.size}-${file.lastModified}`))]
    })
    setError('')
    setUploadStatus('')
  }

  async function reviewDocuments() {
    if (!application || application.documents.length === 0) {
      setError('Upload at least one supporting document before continuing.')
      return
    }
    setError('')
    try {
      const refreshed = await applicationService.getForApplicant(application.id)
      setApplication(refreshed)
      setStep('review')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The application could not be refreshed for review.')
    }
  }

  async function submitApplication() {
    if (!application) return
    setBusy(true)
    setError('')
    try {
      const submitted = await applicationService.submit(application.id)
      setApplication(submitted)
      setStep('complete')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The application could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout area="applicant" title="Upload application">
      <PageHeader eyebrow="APPLY FOR SERVICE" title={application ? 'Document upload' : 'Apply for service'} description="Start a new sample application. Your progress can be saved as a draft." action={<Link className="button button--secondary" to="/applicant">Cancel</Link>} />
      {error && <ErrorState message={error} />}
      {step === 'upload' ? (
        <section className="panel form-panel">
          <div className="applicant-stepper" aria-label="Application progress"><span className="applicant-stepper__active">1&nbsp; Select Service</span><i aria-hidden="true">→</i><span>2&nbsp; Upload Documents</span><i aria-hidden="true">→</i><span>3&nbsp; Review &amp; Submit</span></div>
          <div className="form-section-heading"><span>01</span><div><h2>Select your service</h2><p className="muted">Choose a service and upload its supporting documents.</p></div></div>
          <div className="applicant-service-summary"><strong>Your account details will be used</strong><span>{user?.displayName} · {user?.email}</span><small>Update your profile if these details need to change.</small></div>
          <div
            className={`applicant-dropzone${draggingFiles ? ' applicant-dropzone--active' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDraggingFiles(true) }}
            onDragOver={(event) => { event.preventDefault(); setDraggingFiles(true) }}
            onDragLeave={(event) => { event.preventDefault(); setDraggingFiles(false) }}
            onDrop={(event) => { event.preventDefault(); setDraggingFiles(false); addFiles(event.dataTransfer.files) }}
          >
            <span className="applicant-dropzone__icon" aria-hidden="true">↑</span>
            <strong>Drag and drop your documents here</strong>
            <span>or select files from your computer</span>
            <button className="button button--secondary button--small" type="button" disabled={uploading}
              onClick={() => fileInputRef.current?.click()}>Upload Document</button>
            <input ref={fileInputRef} className="applicant-dropzone__input" type="file" multiple
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={uploading}
              onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
            <small>Accepted formats: PDF, PNG and JPEG. File size and content are validated securely.</small>
          </div>
          {selectedFiles.length > 0 && <ul className="applicant-upload-files" aria-label="Selected files">
            {selectedFiles.map((file, index) => <li key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span>{file.name}</span><small>{file.type || 'File'} · {formatFileSize(file.size)}</small>
              <button className="button button--quiet button--small" type="button" disabled={uploading}
                onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
            </li>)}
          </ul>}
          {uploadStatus && <div className="form-alert" role="status">{uploadStatus}</div>}
          {application && application.documents.length > 0 && <InfoCard title="Uploaded documents and OCR status">
            <DocumentList documents={application.documents} />
            {application.documents.some((document) => document.humanVerificationRequired) && <p className="form-alert">One or more documents need additional verification after submission.</p>}
            {application.documents.some((document) => document.status === 'FAILED') && <p className="form-alert form-alert--error">OCR could not process one or more uploaded documents. The saved documents will remain available for review.</p>}
          </InfoCard>}
          <div className="form-actions">
            <button className="button button--primary" type="button" disabled={uploading || selectedFiles.length === 0}
              onClick={() => void uploadDocuments()}>{uploading ? 'Uploading and processing…' : 'Upload selected files'}</button>
            {selectedFiles.length > 0 && <button className="button button--quiet" type="button" disabled={uploading}
              onClick={() => { setSelectedFiles([]); setError(''); setUploadStatus('') }}>Cancel selection</button>}
            {application?.documents.length ? <button className="button button--secondary" type="button" disabled={uploading}
              onClick={() => void reviewDocuments()}>Review and submit</button> : null}
          </div>
        </section>
      ) : step === 'review' && application ? (
        <section className="panel form-panel">
          <div className="form-section-heading"><span>03</span><div><h2>Review before submission</h2><p className="muted">Confirm your information and attached documents before submitting.</p></div></div>
          <ApplicationSummary application={application} />
          <p className="application-description">{application.details}</p>
          <InfoCard title="Supporting documents"><DocumentList documents={application.documents} />
            {application.documents.some((document) => document.humanVerificationRequired) && <p className="form-alert">Some documents need additional verification. The existing Human Verification process will review them.</p>}
            {application.documents.some((document) => document.status === 'FAILED') && <p className="form-alert form-alert--error">OCR processing failed for at least one document. You may submit the application; the document status will remain visible to the reviewing team.</p>}
          </InfoCard>
          <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => setStep('upload')} disabled={busy}>Back to documents</button><button className="button button--primary" type="button" onClick={() => void submitApplication()} disabled={busy}>{busy ? 'Submitting application…' : 'Submit application'} <span aria-hidden="true">→</span></button></div>
        </section>
      ) : step === 'complete' && application ? (
        <section className="panel form-panel">
          <div className="form-alert" role="status"><strong>Application submitted successfully.</strong> Processing has started. Current status: <StatusBadge status={application.status} />.</div>
          <InfoCard title="Application processing"><ApplicationSummary application={application} />
            {application.documents.some((document) => document.humanVerificationRequired) && <p className="muted">Documents requiring additional verification remain in the existing Human Verification workflow.</p>}
          </InfoCard>
          <div className="form-actions"><Link className="button button--secondary" to={`/applicant/applications/${application.id}`}>View application status</Link><Link className="button button--primary" to="/applicant">Return to applications</Link></div>
        </section>
      ) : null}
    </DashboardLayout>
  )
}

export function ApplicantApplicationDetailsPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const [application, setApplication] = useState<ApplicationRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedId, setLoadedId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [success, setSuccess] = useState('')
  async function load() {
    setLoading(true)
    setError('')
    try { setApplication(await applicationService.getForApplicant(id)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Please try again.') } finally { setLoading(false) }
  }
  async function submitApplication() {
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const updated = await applicationService.submit(id)
      setApplication(updated)
      setSuccess('Your application has been submitted.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The application could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }
  async function uploadDocument() {
    if (!selectedFile) return
    setUploading(true)
    setUploadError('')
    setUploadMessage('')
    try {
      await documentService.uploadForApplicant(id, selectedFile)
      setSelectedFile(null)
      setUploadMessage('Document uploaded and OCR processing completed.')
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : 'The document could not be uploaded.')
    } finally {
      try {
        setApplication(await applicationService.getForApplicant(id))
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : 'Application details could not be refreshed.'
        setUploadError((current) =>
          [current, `Upload response received, but document status could not be refreshed: ${detail}`]
            .filter(Boolean)
            .join(' '),
        )
      }
      setUploading(false)
    }
  }
  useEffect(() => {
    let current = true
    applicationService.getForApplicant(id)
      .then((item) => { if (current) { setApplication(item); setError('') } })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Please try again.') })
      .finally(() => { if (current) { setLoadedId(id); setLoading(false) } })
    return () => { current = false }
  }, [id])
  const successMessage = (location.state as { successMessage?: string } | null)?.successMessage

  return (
    <DashboardLayout area="applicant" title="Application details">
      <PageHeader eyebrow="APPLICATION DETAILS" title={application?.title ?? 'Application'} description={application ? `${application.applicationType} · ${application.id}` : 'View the current information and workflow timeline.'} action={<Link className="button button--secondary" to="/applicant">← All applications</Link>} />
      {(successMessage || success) && <div className="form-alert" role="status">{success || successMessage}</div>}
      {loading || loadedId !== id ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : application && <>
        <div className="details-statusbar"><div><span className="muted">Current status</span><StatusBadge status={application.status} /></div><DeadlineIndicator deadlineAt={application.deadlineAt} breachedAt={application.breachedAt} /></div>
        {application.status === 'REJECTED' && application.rejectionReason && (
          <InfoCard title="Reason from Officer">
            <p>{application.rejectionReason}</p>
            {application.rejectedAt && (
              <p className="muted">Rejected on {new Date(application.rejectedAt).toLocaleString()}</p>
            )}
          </InfoCard>
        )}
        {application.status === 'DRAFT' && <div className="form-actions"><button className="button button--primary" type="button" disabled={submitting} onClick={() => void submitApplication()}>{submitting ? 'Submitting…' : 'Submit application'}</button></div>}
        <InfoCard title="Application information"><ApplicationSummary application={application} /><p className="application-description">{application.details}</p></InfoCard>
        <InfoCard title="Application documents">
          <DocumentList documents={application.documents} />
          {application.status === 'DRAFT' && <>
            <div className="field">
              <label htmlFor="applicant-document-upload">Upload a document (PDF, PNG, or JPEG; size limit is enforced by the server)</label>
              <input
                id="applicant-document-upload"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                disabled={uploading}
                onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
              />
            </div>
            {selectedFile && <p className="muted">Selected: {selectedFile.name}</p>}
            {uploadError && <ErrorState message={uploadError} />}
            {uploadMessage && <div className="form-alert" role="status">{uploadMessage}</div>}
            <div className="form-actions"><button className="button button--secondary" type="button" disabled={!selectedFile || uploading} onClick={() => void uploadDocument()}>{uploading ? 'Uploading and processing…' : 'Upload document'}</button></div>
          </>}
        </InfoCard>
        <InfoCard title="Application timeline"><Timeline entries={application.timeline} /></InfoCard>
        <InfoCard title="Application dates"><dl className="summary-grid"><div><dt>Created</dt><dd>{new Date(application.createdAt).toLocaleString()}</dd></div><div><dt>Last updated</dt><dd>{new Date(application.updatedAt).toLocaleString()}</dd></div><div><dt>Submitted</dt><dd>{application.submittedAt ? new Date(application.submittedAt).toLocaleString() : 'Not submitted'}</dd></div></dl></InfoCard>
        {application.breachedAt && <p className="deadline-message" role="status">This application has exceeded its processing deadline.</p>}
      </>}
    </DashboardLayout>
  )
}

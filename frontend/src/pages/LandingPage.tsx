import { Link } from 'react-router-dom'
import { Brand, Navbar } from '../components/layout'

const roles = [
  { title: 'Applicant', description: 'Create applications, submit documents and follow progress.', to: '/applicant/login', icon: '01' },
  { title: 'Officer', description: 'Review assigned applications and monitor deadlines.', to: '/officer/login', icon: '02' },
  { title: 'General Officer', description: 'Review cases escalated by department officers.', to: '/general-officer/login', icon: '03' },
  { title: 'Human Verifier', description: 'Review documents held for human verification.', to: '/human-verifier/login', icon: '04' },
  { title: 'Admin', description: 'View the cross-department administrative overview.', to: '/admin/auth', icon: '05' },
]

const landingActions = [
  { title: 'Apply for Services', description: 'Start an application with a clear document checklist.', icon: '▤', to: '/applicant/register' },
  { title: 'Track Applications', description: 'Know the stage, assignment and next action at a glance.', icon: '⌁', to: '/applicant/track' },
]

export function LandingPage() {
  return (
    <div className="landing-page">
      <video
        className="landing-page__video"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      >
        <source src="/media/landing-background.mp4" type="video/mp4" />
      </video>
      <div className="landing-page__video-overlay" aria-hidden="true" />
      <Navbar />
      <main>
        <section className="hero-section">
          <div className="hero-section__copy">
            <p className="eyebrow"><span className="eyebrow__dot" /> DIGITAL PUBLIC SERVICES</p>
            <h1>Smarter document<br /><em>processing for everyone.</em></h1>
            <p className="hero-section__lead">Apply, upload and follow your government-service documents in one transparent workflow. Automated assistance helps organize each case while people remain responsible for final review.</p>
            <div className="hero-section__actions"><Link className="button button--primary button--large" to="/applicant/register">Get started <span aria-hidden="true">→</span></Link><Link className="button button--secondary button--large" to="/applicant/login">Applicant login</Link><Link className="button button--secondary button--large" to="/applicant/track">Track an application</Link></div>
            <p className="hero-section__footnote">Demo platform · Fictional records · No government affiliation</p>
          </div>
          <div className="hero-art" aria-label="Illustration of an application moving through review" role="img">
            <div className="hero-art__orb hero-art__orb--one" /><div className="hero-art__orb hero-art__orb--two" />
            <div className="flow-card flow-card--document"><span className="flow-card__file">▤</span><div><strong>Documents, connected.</strong><small>Clear steps. Accountable decisions.</small></div><span className="flow-check">✓</span></div>
            <div className="flow-line"><span /></div>
            <div className="flow-card flow-card--review"><span className="flow-card__avatar">R</span><div><strong>Human-reviewed</strong><small>Progress stays in view</small></div></div>
            <div className="hero-art__caption"><span className="caption-line" /> Permission-scoped · Traceable</div>
          </div>
        </section>
        <section className="landing-actions-section">
          <div className="landing-action-grid">{landingActions.map((action) => <Link className="landing-action-card" to={action.to} key={action.title}><span className="landing-action-card__icon" aria-hidden="true">{action.icon}</span><h3>{action.title}</h3><p>{action.description}</p></Link>)}</div>
        </section>
        <section className="role-section">
          <div className="section-heading"><div><p className="eyebrow">GET STARTED</p><h2>Choose a service area</h2></div><p>Each role has a focused view of the application process.</p></div>
          <div className="role-grid">{roles.map((role) => <Link className="role-card" to={role.to} key={role.title}><span className="role-card__number">{role.icon}</span><span className="role-card__arrow" aria-hidden="true">↗</span><h3>{role.title}</h3><p>{role.description}</p><span className="role-card__link">Continue <span aria-hidden="true">→</span></span></Link>)}</div>
        </section>
        <section className="journey-section"><div className="journey-section__title"><p className="eyebrow">THE JOURNEY</p><h2>A clear process,<br /><em>from start to finish.</em></h2><p>Every stage has an owner. Every important change has a record.</p></div><div className="journey-steps"><div><span>01</span><strong>Choose your service</strong><small>Check eligibility and required documents.</small></div><i aria-hidden="true">→</i><div><span>02</span><strong>Upload &amp; validate</strong><small>Preview originals and check extraction suggestions.</small></div><i aria-hidden="true">→</i><div><span>03</span><strong>Human review</strong><small>Reviewers confirm fields and officers assess the case.</small></div><i aria-hidden="true">→</i><div><span>04</span><strong>Track the decision</strong><small>Respond to corrections and view the recorded outcome.</small></div></div></section>
        <section className="architecture-section">
          <div className="architecture-section__heading">
            <p className="eyebrow">SYSTEM ARCHITECTURE</p>
            <h2>One connected workflow,<br /><em>built for accountability.</em></h2>
            <p>GovDocFlow AI connects applicants, document processing, reviewers and service officers while keeping every decision in its proper place.</p>
          </div>
          <div className="architecture-flow" aria-label="GovDocFlow AI system architecture">
            <div className="architecture-node architecture-node--entry"><span>01</span><strong>Applicant portal</strong><small>Apply, upload and track</small></div>
            <i aria-hidden="true">→</i>
            <div className="architecture-node architecture-node--process"><span>02</span><strong>Document processing</strong><small>OCR and extraction suggestions</small></div>
            <i aria-hidden="true">→</i>
            <div className="architecture-node architecture-node--review"><span>03</span><strong>Review workspace</strong><small>Human verification when needed</small></div>
            <i aria-hidden="true">→</i>
            <div className="architecture-node architecture-node--decision"><span>04</span><strong>Officer decision</strong><small>Department review and outcome</small></div>
          </div>
          <div className="architecture-foundation">
            <span><b aria-hidden="true">⌁</b> Role-scoped access</span>
            <span><b aria-hidden="true">✓</b> Traceable activity</span>
            <span><b aria-hidden="true">▤</b> Original documents preserved</span>
          </div>
        </section>
        <section className="trust-section">
          <div className="trust-illustration" aria-hidden="true"><span className="trust-illustration__roof" /><span className="trust-illustration__building" /><div className="trust-illustration__label">▤ &nbsp; Documents, connected.<small>Clear steps. Accountable decisions.</small></div></div>
          <div className="trust-copy"><p className="eyebrow">HOW IT WORKS</p><h2>AI assists. <em>People decide.</em></h2><ul><li><strong>OCR + human review</strong><span>Extraction suggestions can be uncertain or incomplete. Reviewers compare fields with originals, correct errors and record their reasons.</span></li><li><strong>Security by role</strong><span>Applicants see their own records. Verifiers review assigned documents. Officers decide within their department.</span></li><li><strong>Transparency throughout</strong><span>Follow routing, corrections and decisions with timestamps and accountable actors.</span></li></ul></div>
        </section>
        <section className="landing-help-section"><div><h2>Need help with a document or an application?</h2><p>Find guidance, understand required fields or contact the demo support team.</p></div><div><Link className="button button--primary" to="/applicant/help">Visit Help Centre</Link><Link className="button button--secondary" to="/applicant/help">Contact Support</Link></div></section>
      </main>
      <footer className="landing-footer"><Brand /><span>Public services, delivered with clarity.</span><Link to="/applicant/login">Sign in <span aria-hidden="true">→</span></Link></footer>
    </div>
  )
}

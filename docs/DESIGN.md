# HacKBios UI/UX Design

## 1. Design Principles

The interface should make clear:

- what the application is and who is handling it;
- its current status and next required action;
- the deadline, remaining time, and whether it is breached;
- which documents were submitted and their user-visible processing
  status.

Use clear labels, accessible forms, keyboard navigation, responsive
layouts, and text status indicators. Color must not be the only way to
communicate status.

## 2. Public and Applicant Screens

### Landing page

Introduce HacKBios and provide navigation to Applicant login and
registration.

### Applicant registration

Provide an email/password registration form. Applicant verification
does not use OTP; no additional email-verification step is specified.

```text
Email + password → Register → Login using email + password
```

Provide validation, loading, success and safe error states. A frontend
demo must clearly disclose that it is not production authentication.

### Applicant login

```text
Email
Password
[Log in]
```

Do not add an OTP login step under current requirements. Provide a
generic, useful authentication error without exposing account
enumeration details.

### Applicant dashboard

Show applications, status, Department when known, deadline/breach
information, outstanding Applicant action, and application detail
access. Do not hard-code Department or staffing counts.

### Create application

Collect the approved application information, support private document
selection/upload, provide review before submit, and show processing
status. The UI does not perform OCR, verification, routing, or
assignment.

### Application details and correction

Show application information, uploaded filename/type/time, OCR
processing status and confidence, whether human verification is
required, workflow status, Department when routed, deadline/breach
status, and relevant timeline. Do not show extracted OCR text to
Applicants. Correction/resubmission screens and actions are conditional
on explicit approval of that workflow. If approved, new material must
be represented as a new version; prior submission history remains
visible as appropriate.

Do not expose internal OCR/AI implementation details or sensitive
extracted content unless explicitly authorized by the product and
privacy policy.

## 3. Officer Screens

### Officer login

Allow sign-in with Government Officer ID or registered email and
password. Explain that pending registrations await Admin approval and
show safe backend status messages for rejected or inactive accounts.

### Officer registration and password setup

Validate the Government Officer ID on the backend against the active
Government Officer Registry; show the registry-derived name, email, and
Department, never a Department selector. Officer Access also lets an
Officer check registration status using their Government Officer ID.
Pending and rejected states have no password action. Once
approved, show **Set Your Password**, which opens the existing password
setup form and consumes the one-time credential. Do not display setup
credentials or password values to Admins.

### Officer dashboard

Focus on assigned applications, status, Department, deadline, remaining
time, breach state, search/filter, and application detail access.
Display deadline/breach with text as well as visual styling.

### Officer application detail

Show authorized application and applicant information, original
documents, OCR-extracted information, Human Verification results,
status, and review notes. Provide an explicit **Start Review** action
when the application is `ASSIGNED`, then allow approval, rejection
(reason required), or escalation to the General Officer (reason
required). Merely viewing the application must not start review.

Do not provide confidence controls, missing-field AI warnings, direct
OCR manipulation, or unauthorized validation tools.

## 4. General Officer Screens

### Application submission and tracking

Provide separate General Officer navigation for application submission
and application tracking. Submission is a file-only upload or
drag-and-drop flow that sends the document through the existing OCR,
classification, routing, assignment, and verification pipeline.
Show an immediate receipt using persisted application type, ID, and
applicant name; use classification and OCR-derived values when available.

Tracking lists submissions created from the authenticated General
Officer account. Search by applicant name, Application ID, application
type, and OCR-read document text on the server, returning matching
application records without exposing raw OCR text in search results.
Do not show an escalated-case queue in this workspace.

## 5. Admin Screens

There is one global Admin. Provide organization-wide areas for
Departments, Officers, applications, deadlines/breaches and audit
information according to authorization. Do not expose controls beyond
the approved Admin permission scope.

Add an Officer Registrations section to the existing dashboard. Show
Government Officer ID, name, Department, official email, registration
date, and status; allow inspection before approval or rejection.
Confirm approval and rejection, require a rejection reason, and show a
safe confirmation only. The Officer—not the Admin—continues setup from
their Officer Dashboard. Do not show a development setup link on the
Admin Dashboard or create/activate Officers through general staff
management.

The required Admin authentication concept is an email-based token link:
Admin email → token generated → email sent → link opened → token
validated → authentication/activation action. The interface may
represent the link flow only as its approved details become available.
Do not infer token purpose, lifetime, password requirement, or recovery
behavior.

## 6. Status and Deadline Presentation

The canonical status vocabulary is `DRAFT`, `SUBMITTED`, `PROCESSING`,
`OFFICER_REVIEW`, `ROUTED`, `WAITING_FOR_OFFICER_ASSIGNMENT`, `ASSIGNED`, `UNDER_REVIEW`,
`ESCALATED`, `GENERAL_OFFICER_REVIEW`, `CORRECTION_REQUIRED`,
`RESUBMITTED`, `APPROVED`, and `REJECTED`. General Officer approval and
reasoned rejection are reachable from escalated cases; correction/
resubmission remains outside the implemented workflow.

Deadline example:

```text
Deadline: 08 Oct 2026
Time remaining: 1 day
```

Breach example:

```text
Deadline: 05 Oct 2026
Status: Breached
```

Deadline breach is separate from workflow status. Do not invent SLA
duration, grace period, breach consequence, or notification behavior.

## 7. Routing/OCR Visibility

The UI may present backend-provided canonical workflow states. It must
not imply an unapproved decision outcome or suggest that the frontend
determines OCR results, business verification,
Department routing, or Officer assignment. Officer views must not expose
internal OCR/AI inspection.

### Dedicated human-verification workspace

Provide a separate processing-stage queue and document-review screen
for backend-authorized General Officer/Human Verification actors with
the human-verification permission. This is not part of the normal
Officer dashboard or escalated-case decision flow. The screen includes
application ID, document ID/type, submission time, reason, current
verification status, OCR score, extracted text, and authorized access
to the private original document.

Clearly label scores below the configured OCR threshold (90% by
default) as `LOW OCR CONFIDENCE`. Provide **View Original Document**,
**View OCR Text**, **Verify**, and **Reject** actions. Capture a
verification note/reason where required; rejecting requires a reason.
Verification actions must be recorded by the backend audit service.
Verifying releases the document to normal document understanding and
backend routing. Rejection is handed to the existing rejection/
escalation workflow without this screen inventing an application-state
transition.

Do not expose extracted OCR text or processing controls to Applicants
or ordinary Officers. Applicants may see the persisted OCR status,
confidence, and verification-required indicator for their own
documents. Never use public document URLs. A frontend demo must
identify synthetic document previews and mock decisions as
non-production.

## 8. Reusable Components and Interaction States

Use shared components where appropriate:

- Navbar and role-specific navigation;
- sidebar and dashboard layout;
- application card/table;
- status badge;
- deadline indicator;
- file upload;
- application details/timeline;
- loading, error, and empty states;
- confirmation dialog for consequential actions.

Every asynchronous operation needs loading, success, empty (where
applicable), and error handling. Forms need associated labels,
validation feedback, keyboard support, and accessible focus behavior.

## 9. Mock and Backend Boundary

Isolate data access behind a replaceable service/API boundary. Applicant
authentication, application records, and document uploads use the
backend API. Remaining mock login, staff workflow, notification, and
sample workflow actions are demonstrations only; they do not provide
security, send email, store files privately, or perform backend
decisions. Do not include Applicant OTP screens or unapproved General
Officer action flows in the mock UI.

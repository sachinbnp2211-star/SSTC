# HacKBios Development Phases

## Phase 0 — Documentation Foundation

### Goal

Make the six files in `docs/` the consistent source of truth before
feature implementation.

### Deliverables and exit criteria

- Applicant email/password registration, organization, Officer provisioning,
  routing/assignment, escalation/correction, security, deadline, and
  open decisions are consistent across all six documents.
- No obsolete requirement remains in conflict.
- Unresolved product/security decisions are explicitly listed.

## Phase 1 — Frontend Foundation

### Build

- Public landing page and role-specific navigation.
- Applicant registration and login UI using email and password; do not
  add OTP or an unspecified email-verification step.
- Applicant dashboard, application creation, private-upload UI,
  details, deadline/breach and timeline states.
- Correction/resubmission UI only after the General Officer action set
  and correction workflow are approved.
- Officer registration/login, one-time password setup UI,
  dashboard, assigned cases, status/deadline, case details, and
  escalation action.
- General Officer escalated-case queue/details and approved
  approve/reject decisions; correction/resubmission actions remain out
  of scope.
- Admin views for organization-wide information; defer Admin auth UI
  specifics until its mechanism is approved.
- Reusable components and accessible loading, empty, error and
  confirmation states.

### Boundaries

- Mock/demo behavior must be clearly identified and isolated.
- Do not connect to an unapproved backend contract.
- Do not implement real authentication, OCR, business verification,
  routing, assignment, or deadline decisions
  in frontend code.
- Do not expose OCR/AI inspection, confidence controls, missing-field
  AI warnings, or OCR manipulation to Officers.
- Do not treat route protection or mock login as security.

### Exit criteria

- All required role screens and workflow states are represented.
- No disallowed Officer interface is present.
- Applicant authentication screens represent email/password only.
- Unapproved General Officer actions and correction/resubmission flows
  remain clearly marked as undecided, not implemented as final behavior.

## Phase 2 — Backend Foundation and Identity

### Build

- Backend project foundation and validated API contract.
- Applicant email/password registration/login and secure password
  hashing.
- Officer and single Admin identity/role model.
- Officer provisioning through a separate Government Officer Registry,
  Admin approval/rejection, exactly-one-Department association, and
  secure expiring single-use password setup/reset.
- Admin authentication only after its mechanism is approved.
- Implement the Admin email-token link concept only after its purpose,
  lifetime, password relationship and recovery/reset behavior are
  approved.
- Server-side authorization, input validation, session/token security,
  audit foundation and abuse controls.

### Officer registration and approval (implemented)

- Seed only synthetic Government Officer Registry identities; never
  automatically provision the 150 corresponding User accounts.
- Self-registration validates Government Officer ID, registered name,
  official email, and active registry/Department state. The Department
  comes only from the registry.
- Keep one User account per Government Officer ID, with authoritative
  `PENDING`, `ACTIVE`, `REJECTED`, or `SUSPENDED` account status.
- Review and approve/reject through existing Admin `USER_MANAGE`
  authorization; record approval/rejection audit events.
- Approval sends an expiring, one-time setup link. In development,
  email capture may remain in memory for testing. The Admin only
  approves/rejects; the Officer checks approval on Officer Access by
  Government Officer ID and uses a separate, expiring registration credential to complete
  password setup. No setup URL is exposed in Admin APIs or UI.
- Setup requires password confirmation, hashes the chosen password, and
  consumes the link. Officer can then log in normally; passwords and
  tokens are never returned in production approval responses.
- Reuse existing JWT and bcrypt; preserve Applicant and Admin login.
- Email delivery is injectable but no production provider is configured.
  Production approval requires a configured sender and returns only a
  safe success message.

## Phase 3 — Applications and Private Documents

### Build

- Persist applicant application drafts in MongoDB with authenticated
  ownership, required application data, creation/update/submission
  timestamps, and the canonical `DRAFT` → `SUBMITTED` transition.
- Provide applicant-scoped create/list/detail/submit APIs with
  server-side authorization and validation.
- Connect Applicant create, list, detail, and submit screens to those
  APIs. Do not use seeded/mock application records for Applicant views.
- Preserve the existing workflow state vocabulary and reject invalid
  transitions.
- Application revisions and correction/resubmission remain gated by
  their open product decisions.
- Applicant-owned PDF, PNG, and JPEG uploads use authenticated,
  ownership-scoped APIs, private local storage, server-side file
  validation, and MongoDB document metadata. Originals are served only
  through authenticated authorization-checked endpoints; no public
  upload directory is exposed.
- Applicant application details display persisted document metadata,
  OCR status/confidence, and the human-verification-required state.
- The existing OCR confidence gate is wired to local Tesseract OCR for
  images and PDF.js-rendered PDFs. OCR scores and private extracted-text
  references are persisted; low-confidence documents are marked
  `LOW_CONFIDENCE`/`PENDING`, while scores at or above the configured
  threshold are marked `COMPLETED`. The default 90% threshold is
  unchanged.
- OCR failure preserves the original and document metadata with a
  failure state. Retry orchestration, retention/version
  history, broader document understanding, and the Human Verifier UI
  remain future work.

## Phase 4 — OCR and Document Understanding

### Build

- A MongoDB-backed queue selects documents with `LOW_CONFIDENCE` OCR
  and `PENDING` verification status.
- The Human Verifier role and `HUMAN_VERIFY_OCR` permission protect the
  queue, review API, decision API, and private original-document
  endpoint. Applicants and other roles cannot use verifier APIs.
- The review UI displays OCR confidence/text and the privately fetched
  original. Verifiers can edit extracted fields and persist an
  approval or rejection with their authenticated user ID and timestamp.
- Approval stores corrected extracted data and sets verification status
  to `VERIFIED`; rejection stores the verifier and reason and sets it to
  `REJECTED`. Both retain the original document. Pending-only atomic
  updates prevent a second decision from overwriting the first.
- The OCR confidence score and `LOW_CONFIDENCE` OCR state are preserved;
  the configured 90% threshold and OCR implementation are unchanged.
- Broader document understanding, business decisions, routing,
  assignment, and decision retry/recovery
  remain future work.

### Boundary

This phase persists human-verification outcomes; lifecycle advancement
to `OFFICER_REVIEW` occurs only after all documents are eligible. It does
not trigger document understanding, routing, or assignment. OCR extracts and understands documents;
it does not perform final business verification, approve/reject, make
final Department decisions, or assign Officers. OCR confidence is
distinct from Department-routing confidence.

## Phase 5 — Business Verification and Department Routing

### Build

- Backend business-rule verification using application information and
  appropriate document evidence.
- Backend routing using broader relevant application and
  document-understanding content.
- Routing result and rationale/history storage.
- Explicit uncertainty fallback; no silent guessing.

### Gate

Routing algorithm, thresholds and fallback behavior must be approved
before production behavior is fixed.

## Phase 6 — Atomic Officer Assignment

### Build

- Eligible-Officer selection restricted to the routed Department.
- Pending count includes exactly `ASSIGNED` and `UNDER_REVIEW`.
- Least-pending selection with fair deterministic tie-break:
  oldest most-recent assignment timestamp across application history
  first (never-assigned first), then stable User ID.
- Department-scoped database lease serialization for concurrency-safe
  workload counts and assignment persistence.
- `WAITING_FOR_OFFICER_ASSIGNMENT` when no eligible Officer is available.
- Assignment history and audit events.

## Officer Review workflow (implemented)

### Build

- Department-scoped Officer queue and authorized application/document
  views, including OCR and Human Verification results.
- Explicit Start Review action to enter `UNDER_REVIEW`.
- Approve, reject with a reason, or escalate with a reason.
- Persist decision, authenticated Officer identity, timestamp, and
  review notes.

### Explicitly excluded

- OCR/AI confidence controls.
- Officer OCR manipulation.
- Missing-field AI warnings.
- Unauthorized document-validation logic.
- General Officer decision workflow.

Current Officer authorization is Department-scoped. Individual Officer
assignment is not yet represented by the application model.

## General Officer Review workflow (implemented)

### Build

- MongoDB-backed queue of `ESCALATED` applications and protected case
  details, including applicant, document, OCR, verification, and Officer
  review information.
- Secure private original-document access for authorized General
  Officers.
- Approve an escalated application or reject it with a required reason.
- Persist General Officer identity and decision timestamp, and reject
  stale decisions.

### Excluded

- Correction/resubmission workflow and related notifications.
- Admin workflow.

## Phase 7 — Application Lifecycle + Audit Trail

### Build

- Advance submitted applications through `SUBMITTED` and `PROCESSING`
  to `OFFICER_REVIEW` only after all uploaded documents complete OCR and
  low-confidence documents complete Human Verification.
- Preserve supported operational states such as `ASSIGNED`,
  `UNDER_REVIEW`, `ESCALATED`, and final outcomes; reject stale or
  invalid transitions on the backend.
- Persist append-only MongoDB audit events for application creation
  and submission, document upload and OCR outcomes, Human Verification,
  Officer review/decisions/escalation, and General Officer decisions.
- Record authenticated actor ID/role, applicable application/document
  IDs, previous/new status, reason where applicable, and server time.
- Prevent event updates and deletes through the application data model;
  do not expose audit mutation or read APIs in this phase.

### Excluded

- Admin audit browsing, notifications, correction/resubmission, and
  assignment workflow.

## Phase 9 — Deadlines and Notifications

### Build

- Deadline storage, remaining-time calculation, breach detection and
  recovery, breach history, and role-appropriate visibility.
- Notification behavior only as approved; correction and final-outcome
  notifications are not assumed while their triggering actions remain
  open.

### Gate

Do not set SLA duration, grace period, post-breach consequences, or
additional deadline notifications until approved.

## Phase 10 — Admin and Organization-Wide Oversight

### Build

- Single global Admin dashboard and authorized organization-wide
  Department, Officer, application, deadline/breach and audit views.
- Administrative management operations only within the approved
  permission scope.
- Required Admin email-token link flow only after its purpose, lifetime,
  password relationship and recovery/reset behavior are documented.

## Phase 11 — Security, Integration, and Acceptance

### Verify

- Email/password authentication, secure password hashing, and no secret
  logging.
- Secure setup/reset, authentication and role/resource authorization.
- Private original documents and separated OCR outputs.
- Configurable OCR confidence threshold, low-confidence routing block,
  authorized human-verification decisions, private document access and
  audited outcomes.
- Boundary tests: 95% and 90% continue; 89% queues and cannot route;
  50% continues only after verification; rejection invokes only the
  existing rejection/escalation workflow.
- OCR/business verification/routing/assignment boundaries.
- Concurrent assignment fairness, uniqueness and waiting queue.
- Escalation and preserved history, including General Officer
  approve/reject decisions. Correction/resubmission remains excluded.
- Deadline/breach behavior and recovery.
- Full workflow across Applicant, Officer, General Officer, and Admin.

## Phase 12 — MVP Demonstration

Demonstrate:

```text
Applicant email/password registration and login
  → application and private document submission
  → OCR/document understanding
  → OCR confidence gate (low scores wait for authorized verification)
  → backend verification and Department routing
  → atomic least-pending Officer assignment or waiting queue
  → Officer review and escalation
  → General Officer handles escalation
  → General Officer approval or reasoned rejection
  → deadline/breach visibility, approved notifications and audit
```

Include an `WAITING_FOR_OFFICER` case and a breached case. Do not use
fake production authentication or public documents. Correction/
resubmission behavior remains out of scope.

## Team Responsibilities

### Frontend Developer

Applicant, Officer, General Officer and Admin UI; workflow presentation,
accessible states and isolated API client/mock boundary. No security,
OCR, routing, assignment or workflow decisions.

### Backend Developer

Authentication, APIs, database, application workflow, deadline
processing, escalation, authorization, notifications and audit.

### OCR Developer

OCR, document preprocessing, content extraction and document
understanding and extraction confidence evidence; provide protected
input for backend processing and routing. The backend owns the
configurable confidence threshold and verification gate. No final
business, Department-routing or assignment decisions.

### Fourth Developer / Integration

Department classification and backend routing integration, testing,
documentation, cross-service integration, and an AI layer only if
required and approved. Final Department routing and Officer assignment
remain backend/system decisions; do not delegate decision authority to
OCR or the frontend.

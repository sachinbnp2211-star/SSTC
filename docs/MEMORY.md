# HacKBios Project Memory

## 1. Current Decisions

This file summarizes the current product requirements. The PRD and the
other companion documents are the source of truth. If this summary
drifts from them, update it rather than treating it as an override.

### Applicant registration and login

- Applicant registration and login use email and password.
- Passwords are securely hashed and never stored in plaintext.
- Applicant OTP registration, challenge, verification, and OTP-based
  login are not requirements. No additional email-verification step is
  specified.

### Organization and Officer provisioning

- 10 Departments; 15 government Officers per Department; 150 Officers
  total; exactly one global Admin.
- Organization data is represented as configuration/data, not
  hard-coded frontend behavior.
- Each Officer has a unique government Officer ID and belongs to exactly
  one Department.
- The synthetic Government Officer Registry is separate from User
  accounts; seeding identities never provisions accounts. Self-
  registration checks the active identity, registered name/email, and
  derives Department from the registry.
- Registration starts `PENDING`; existing Admin `USER_MANAGE` approval
  activates or rejects it. `ACTIVE`, `REJECTED`, and `SUSPENDED` are
  authoritative account statuses synchronized with the existing
  `isActive` check. A rejected identity may resubmit using its existing
  User account.
- Approval creates a 24-hour, single-use setup link whose hash alone is
  stored. Officer chooses a password through the setup form; it is
  bcrypt-hashed and the token is consumed before normal login is enabled.
- The Officer Access page checks minimal registration status by
  Government Officer ID. Registration separately gives the submitting
  Officer an expiring password-setup credential; only its hash is stored.
  The ID alone cannot authorize setup. The credential is consumed after
  password setup and cannot access Officer application routes.
- Admin approves or rejects registrations and never sees setup URLs or
  tokens. Development email capture may remain in memory for testing,
  but has no Admin preview API or UI. Production responses never include
  setup URLs or tokens.
- The existing JWT, bcrypt, User, Admin authorization, and audit paths
  are reused. Login accepts Government Officer ID or email; Applicant
  and Admin login behavior is unchanged.
- Synthetic identities use `example.test` addresses and are not real
  government identities. No production email provider is configured:
  development can capture the email internally for testing, and
  production approval fails safely without an injected email sender.

### Processing and routing

- OCR/document understanding extracts and interprets information; it
  does not make final business decisions, approve/reject, determine
  final Department routing, or assign Officers.
- Store an OCR confidence percentage per processed document. Backend
  `OCR_THRESHOLD` defaults to 90%; a score below the configured
  threshold requires human verification and blocks automatic document
  understanding/routing until verified. Exactly 90% passes at the
  default threshold.
- Applicant uploads support PDF, PNG, and JPEG. Original files and
  extracted OCR text are kept in private backend storage; MongoDB stores
  metadata and protected references. Applicants see document metadata,
  OCR state/confidence, and whether verification is required, but not
  extracted text.
- Local Tesseract OCR handles images and PDF.js renders PDFs. Low
  confidence is persisted as `LOW_CONFIDENCE` with verification
  `PENDING`; retry handling, full review queue/UI, and routing remain
  future work.
- Human verification is a separate processing-stage permission for
  authorized General Officer/Human Verification actors. The queue
  exposes OCR evidence and privately authorized original-document
  access, not through the normal Officer dashboard. Record verifier,
  time, status, note, and audit event.
- Verified documents continue through broader document understanding,
  Department classification, routing, and assignment. Rejection is
  handed to the existing rejection/escalation workflow; no application
  state transition is inferred by the confidence gate.
- Backend business logic performs verification.
- Backend routing chooses the Department using broader relevant
  application and document-understanding content.
- Backend assignment chooses an Officer only after routing.
- Frontend does not run OCR or make verification/routing/assignment
  decisions; it displays the Applicant-safe OCR status information
  returned by the backend.

### Assignment

- Select an eligible Officer in the routed Department with the least
  pending applications.
- Pending for assignment means exactly `ASSIGNED` and `UNDER_REVIEW`.
- Equal counts use the oldest most-recent assignment timestamp across
  application history (never assigned first), then stable User ID.
- A Department-scoped database lease serializes workload reads and
  assignment writes; pending counts include exactly `ASSIGNED` and
  `UNDER_REVIEW`.
- If no eligible Officer is available, use `WAITING_FOR_OFFICER_ASSIGNMENT`; never
  silently send the case to another Department.

### Officer and General Officer

- Officers see assigned applications and authorized original documents,
  status/deadline, and may record adverse/uncertain findings for
  escalation.
- Officer adverse findings become `ESCALATED`, not final `REJECTED`.
- Officers have no OCR/AI inspection, confidence controls, missing-field
  AI warnings, or direct OCR manipulation.
- Only the currently assigned Officer can move `ASSIGNED` to
  `UNDER_REVIEW`, by explicitly performing **Start Review**; viewing a
  case does not start review.
- General Officer handles escalations and may approve or reject them;
  rejection requires a reason. Correction requests and resubmission
  remain **OPEN** and are outside this workflow.
- Escalation preserves application/version, originating Officer,
  reason, timestamp, status, and audit history.

### Applicant correction and history

- Whether correction requests and Applicant resubmission are supported
  remains **OPEN**.
- If later approved, correction/resubmission must preserve earlier
  application/document versions and actions. Do not assume its
  notification or re-routing/reassignment behavior.

### Admin and security

- Exactly one global Admin has organization-wide authorized scope.
- Admin can view/manage Departments, Officers, applications,
  deadlines/breaches and audit information within approved permissions.
- Admin authentication has an email-token link concept: Admin email →
  token generated → email sent → link opened → token validated →
  authentication/activation action.
- Token purpose, lifetime, whether Admin also has a password, and
  recovery/reset behavior remain **OPEN**.
- Documents are private with no public URLs; original files and OCR
  results are separate; backend authorization is mandatory.
- Passwords, setup/reset tokens, Admin tokens and secrets are never
  stored/logged in plaintext or hard-coded.

### Deadlines

- Deadline and breach are required and independent of workflow state.
- Exact SLA, grace period, consequences, and notification rules are not
  specified and must not be invented.

## 2. Application States

Current lifecycle vocabulary:

```text
DRAFT → SUBMITTED → PROCESSING → ROUTED
                                  ├→ WAITING_FOR_OFFICER_ASSIGNMENT → ASSIGNED
                                  └→ ASSIGNED
                                       → UNDER_REVIEW (explicit Start
                                         Review by assigned Officer)
                                                   → [adverse/uncertain]
                                                     ESCALATED
                                                     → GENERAL_OFFICER_REVIEW
                                                          ├→ APPROVED
                                                          └→ REJECTED
                                                               (reason required)
```

Canonical vocabulary also includes `CORRECTION_REQUIRED`,
`RESUBMITTED`, `APPROVED`, and `REJECTED`; correction/resubmission
transitions remain **OPEN**. General Officer rejection requires a reason.
Deadline breach is orthogonal. See
`ARCHITECTURE.md` for transition constraints.

## 3. Open Decisions

Do not silently resolve:

- Admin email-token purpose, lifetime, whether Admin also has a
  password, and recovery/reset behavior;
- Production email provider, retries, and delivery policy for Officer
  setup links (the current adapter is injectable; no provider is
  configured). Dashboard setup remains available after approval;
- whether Officers may directly approve non-adverse cases;
- Applicant password/account recovery behavior, if required by product
  policy;
- General Officer action set and any resulting application transitions;
- whether correction/resubmission and related Applicant notifications
  are part of the approved workflow;
- Department-classification/routing algorithm, routing-confidence
  threshold and uncertainty fallback (not the OCR threshold);
- human-verifier permission provisioning/assignment mechanism, if not
  covered by the approved authorization policy;
- whether correction resubmission repeats routing/reassignment;
- exact SLA, grace period, breach consequences and notifications;
- additional notification channels/retry policy;
- Admin management permissions;
- retention/deletion requirements for documents, OCR results and audit
  history.

## 4. Repository Context

```text
HacKBios/
├── frontend/
├── backend/
├── ocr/
└── docs/
    ├── PRD.md
    ├── ARCHITECTURE.md
    ├── RULES.md
    ├── PHASES.md
    ├── DESIGN.md
    └── MEMORY.md
```

The frontend foundation proposes React, TypeScript, and Vite. It is a
technology proposal, not a product requirement. Backend, data store,
email, file storage, and OCR technology remain subject to technical and
security review.

## 5. Documentation Maintenance

Before implementation, read all six documents. When requirements
change, update PRD, Architecture, Rules, Phases, Design, and Memory
together. These files must remain internally consistent.

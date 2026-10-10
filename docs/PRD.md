# HacKBios Product Requirements Document

**Status:** Current product requirements  
**Project:** HacKBios  
**Theme:** Smart Governance / e-Governance and document processing

## 1. Source of Truth

This document and the five companion files in `docs/` form the single
source of truth for HacKBios. The documents must remain consistent.
`MEMORY.md` summarizes decisions; it does not override this PRD.

## 2. Product Summary

HacKBios is a system for receiving government applications, processing
their documents, routing applications to the appropriate Department,
assigning them to Department Officers, and handling escalated cases.
Applicants can track application status and deadlines. A single global
Admin oversees authorized organization-wide information.

The frontend presents information and collects user input. Backend
services own authentication, authorization, document access, processing
orchestration, verification, Department routing, Officer assignment,
deadlines, notifications, and audit history.

## 3. Goals and Non-Goals

### Goals

- Support Applicant registration and login using email and password.
- Allow government Officers to self-register against the synthetic
  Government Officer Registry and require Admin approval before login.
- Require an approved Officer to complete one-time password setup before
  login.
- Support private document submission and status visibility.
- Accept PDF, PNG, and JPEG through authenticated, application-owner-
  scoped upload APIs with server-side type and configurable size checks.
- Show applicants their own document metadata, OCR status/confidence,
  and verification-required state without exposing extracted OCR text.
- Use OCR/document understanding to extract and interpret relevant
  document content.
- Calculate and store an OCR confidence score for every processed
  document. A score below the configurable `OCR_THRESHOLD` (default
  90%) requires authorized human verification before document
  understanding, Department classification, routing, or assignment.
  Scores equal to or above the configured threshold may continue
  automatically.
- Use backend business logic for verification, Department routing, and
  Officer assignment.
- Reduce routing errors by considering broader relevant application and
  document content rather than one isolated field.
- Assign routed applications fairly and safely within their Department.
- Support Officer review and escalation of adverse or uncertain cases.
- Support General Officer handling of cases escalated by Officers.
- Track deadlines and clearly communicate overdue/breached status.
- Preserve workflow, document-version, and audit history.

### Non-Goals

- OCR is not the final business-rule verifier or decision-maker.
- OCR does not make the final Department routing decision or assign an
  Officer.
- The frontend does not implement OCR, verification, routing, or
  assignment logic.
- Officers do not receive OCR/AI inspection controls, AI confidence
  controls, missing-field AI warnings, direct OCR manipulation, or
  unauthorized document-validation logic.
- An Officer adverse finding is not a final rejection; it is escalated
  to a General Officer.
- No external government identity-provider integration is required or
  implied.

## 4. Organization and Roles

The organization consists of 10 Departments, 15 government Officers per
Department (150 Officers total), and exactly one global Admin. These are
organization requirements, not values to hard-code into frontend
behavior.

### Applicant

An Applicant can:

- register and log in using email and password;
- create and submit applications and upload documents;
- view application details, status, Department, authorized document
  statuses, timeline, deadline, and breach status;
- participate in a correction/resubmission flow only if that workflow
  is explicitly approved;
- receive relevant workflow notifications.

### Department Officer

Each Officer:

- has a unique government Officer ID;
- belongs to exactly one Department;
- registers using an active identity in the Government Officer Registry;
- receives the Department from that registry; applicants cannot choose
  a Department during registration;
- remains pending and cannot log in until the Admin approves the
  registration;
- authenticates with Government Officer ID or registered email and a
  bcrypt-hashed password after approval;
- completes a 24-hour, single-use password setup link before login;
- receives applications assigned within that Officer's Department.

The registry is an allowlist, not an account store. It contains synthetic
demo identities only; seeding it does not provision User accounts.
Registration has one account per Government Officer ID. A rejected
identity may submit again for review using the existing account; pending
and active identities cannot create duplicates. Admin approval and
rejection use the existing Admin authorization and audit paths.

An Officer can view assigned application information and authorized
original documents, see status and deadline information, review a case
according to the approved workflow, record an adverse or uncertain
finding, and escalate that case to the General Officer. Until a separate
Officer final-decision authority is approved, adverse findings must
transition to `ESCALATED`, not `REJECTED`.

### General Officer

The General Officer handles Officer-escalated cases and may approve an
application or reject it with a reason. Correction requests and
Applicant resubmission are not included in this workflow.

### Admin

Exactly one global Admin can view and manage organization-wide
information within the authorization policy, including Departments,
Officers, applications, deadlines/breaches, and audit information. The
documented authentication concept is an email-based token link:

```text
Admin email → token generated → email sent → Admin opens link
            → token validated → authentication/activation action
```

The exact token purpose, lifetime, whether it is for activation, login,
or password setup, whether Admin also has a password, and token
recovery/reset behavior remain **OPEN**.

## 5. Applicant Registration and Authentication

Applicant registration and login use email and password:

```text
Email
  → create account with password
  → login using email + password
```

There is no OTP registration, challenge, verification, or OTP-based
login for Applicants.
Passwords are securely hashed and never stored in plaintext. No
additional email-verification step is specified.

## 6. Officer Registration and Authentication

Officer registration and approval follow this implemented sequence:

```text
Government Officer ID + registered name/email
  → validate against active Government Officer Registry
  → create/reuse User account with registry Department and PENDING status
  → Admin approves or rejects using existing USER_MANAGE permission
  → Officer checks status on the Officer Dashboard
  → approval makes password setup available to that Officer
  → Officer sets a password through the existing setup form
  → Officer logs in by Government Officer ID or email
```

The registry is separate from User accounts, and synthetic registry
seeding does not create accounts. The registry determines Department;
there is no Department selection during Officer registration. Pending,
rejected, and inactive Officers cannot log in. Approval rechecks the
registry and Department and records the Admin action. Setup tokens are
one-time, expire after 24 hours, and are stored only as hashes.
Passwords use the existing bcrypt mechanism and are never returned or
logged. No external government identity provider is assumed.

No production email sender is configured. Development may capture the
setup email in memory for testing, but neither the Admin API nor UI
exposes its setup path. The Officer uses their own dashboard after
approval. Production approval fails explicitly until a sender is
configured.

## 7. Application Workflow

The high-level workflow is:

```text
Applicant registration with email and password
  → login
  → application creation
  → private document upload and submission
  → OCR/document understanding
  → backend business-rule verification
  → backend Department routing
  → concurrency-safe least-pending Officer assignment
  → assigned Officer explicitly starts review
  → Officer review
      ├─ approve → APPROVED
      ├─ reject with reason → REJECTED
      └─ escalate with reason → ESCALATED
  → General Officer handles escalated cases
      ├─ approve → APPROVED
      └─ reject with reason → REJECTED
  → status and notifications as authorized by the approved workflow
  → preserved audit and application history throughout
```

The application lifecycle vocabulary is:

`DRAFT`, `SUBMITTED`, `PROCESSING`, `OFFICER_REVIEW`, `ROUTED`, `WAITING_FOR_OFFICER`,
`WAITING_FOR_OFFICER_ASSIGNMENT`, `ASSIGNED`, `UNDER_REVIEW`, `ESCALATED`, `GENERAL_OFFICER_REVIEW`,
`CORRECTION_REQUIRED`, `RESUBMITTED`, `APPROVED`, and `REJECTED`.

An Officer's adverse or uncertain finding results in `ESCALATED`; it
does not become a final `REJECTED` state. An authorized General Officer
may transition an `ESCALATED` case to `APPROVED` or `REJECTED`; rejection
requires a reason, and both decisions persist the authenticated
reviewer's identity and timestamp. Correction/resubmission behavior
remains **OPEN** and is not part of the current workflow.

Applicant submissions transition through `SUBMITTED` to `PROCESSING`.
The application reaches `OFFICER_REVIEW` only after OCR is complete and
any required Human Verification is resolved. Significant lifecycle,
document, verification, and review actions are recorded in append-only
audit events with authenticated actor identity and role.

`ASSIGNED → UNDER_REVIEW` occurs only through an explicit **Start
Review** operation performed by the Officer currently assigned to the
application. Viewing a case or loading its details does not start review.
The backend verifies the active assignment and current state before
performing this transition.

Account lifecycle is separate from application lifecycle. Deadline
breach is an independent property/event, not an application state.

### Officer assignment requirements

After Department routing, the backend selects an eligible Officer only
from that Department, choosing the Officer with the fewest pending
applications. For this purpose, pending workload includes exactly
`ASSIGNED` and `UNDER_REVIEW`; all other application states are excluded.
For equal counts, choose the Officer whose most recent assignment across
application history is oldest first (an Officer never assigned sorts
first), then stable User ID in ascending order.

Counting and assignment are serialized by a Department-scoped database
lease lock, with the application eligibility checked again under the
lock. If no eligible Officer is available, the application enters
`WAITING_FOR_OFFICER_ASSIGNMENT`. It must never be silently assigned to a
different Department. `ARCHITECTURE.md` defines the operational details.

## 8. OCR, Verification, Routing, and Assignment Boundaries

These are distinct responsibilities:

1. **OCR/document understanding** extracts text/data and interprets
   documents where required. It preserves processing results separately
   from original documents. It does not make final business decisions,
   approve/reject applications, determine final Department routing, or
   assign Officers.
2. **Business verification** is performed by backend business logic
   using the application, document metadata, and appropriate extracted
   evidence. OCR output is evidence, not a final decision.
3. **Department routing** is performed by backend routing logic using
   broader relevant application and document-understanding content.
   Uncertain routing must use an explicit fallback; the system must not
   silently guess.
4. **Officer assignment** is performed by the backend only after a
   Department is selected, using the least-pending eligible Officer in
   that Department and the concurrency rules in `ARCHITECTURE.md`.

The frontend may display processing/routing/assignment workflow states
and authorized results; it must not implement any of these decisions.

### OCR confidence and human verification

OCR confidence measures extraction reliability only; it is distinct
from Department-classification confidence. The backend configuration
must provide `OCR_THRESHOLD`, defaulting to 90%, without duplicating the
threshold as a magic number. A score equal to or above the configured
threshold passes the normal OCR gate. Below-threshold scores remain
marked `LOW_CONFIDENCE`; the OCR threshold is not lowered or bypassed.

After OCR succeeds, AI quality assessment evaluates readability, quality,
noise, and document-specific fields before the existing classification
service runs. Deterministic text metrics and exact quote checks are
persisted; document field profiles are extensible and are currently
defined for Health and Income Certificates. AI-reported field
completeness is validated and recorded, but the decision uses
evidence-verified completeness calculated by the backend.

Scores below configurable `OCR_QUALITY_HARD_MINIMUM` (default 50%) always
require Human Verification. Scores from that minimum up to
`OCR_QUALITY_MODERATE_FLOOR` (default 60%) require the strongest configured
quality, field-completeness, confidence, evidence, consistency, and noise
signals. Scores from the moderate floor to `OCR_THRESHOLD` require
readability, `safeForAutomation`, consistency, quality score at least
0.85, verified field completeness at least 0.80, and acceptable noise.
Scores meeting `OCR_THRESHOLD` still require the quality/readability/noise
checks before existing classification, department routing, and
assignment. These signals never override OCR processing failure or
missing/unusable OCR text. Thresholds and quality limits are
configurable; model-reported confidence is not calibrated and cannot
replace exact OCR evidence.

Any malformed/unavailable assessment, unsupported low-confidence type,
missing or uncertain fields, insufficient evidence, inconsistent result,
or processing failure requires Human Verification. The verifier may
inspect the private original and OCR output, record a verification note,
and verify or reject. Every verification action is audited. A verified
document continues through broader document understanding and backend
Department classification, routing, and assignment. A rejection is
handed to the existing rejection/escalation workflow; this gate does not
invent an application state transition.

The human-verification permission is separate from ordinary Officer
review. It does not grant normal Officers OCR/AI inspection or controls,
and it does not settle the General Officer's separate escalated-case
decision set. OCR itself cannot verify business rules, route, assign,
approve, or reject an application.

## 9. Deadline and Breach Requirements

Applications requiring processing must expose their deadline, remaining
time where applicable, and breach/overdue status. Breach must be
communicated in text and not by color alone. Deadline/breach is
orthogonal to workflow status; an escalated or correction-required case
can also be overdue.

The exact SLA duration, Department-specific SLA, grace period,
post-breach consequence, and deadline notification policy are not
defined here and must not be invented.

## 10. Security and Privacy Requirements

- Backend authorization is mandatory for every protected operation and
  document access; frontend route protection is not security.
- Sensitive original documents remain private and have no public URLs.
- Applicant document uploads are stored outside public static directories
  under server-generated storage identifiers. The default local storage
  adapter is replaceable; upload size and PDF page limits are configurable.
- Original-file retrieval verifies the applicant owns the document's
  application, or requires the dedicated pending-verification role and
  permission for a pending review.
- Original documents and OCR/document-understanding results are stored
  separately and protected by appropriate authorization.
- Passwords, setup/reset tokens, Admin tokens, and secrets are
  never stored or logged in plaintext. Passwords and persisted
  verification tokens are securely hashed.
- Never hard-code credentials, API keys, or tokens.
- Use secure transport, input validation, abuse/rate controls, and
  least-privilege access.
- Do not send sensitive documents to an external OCR/AI provider unless
  that provider and data flow have been approved.
- Preserve an auditable record of important actions without recording
  secrets or unnecessary document contents.

## 11. MVP Acceptance Criteria

The MVP should demonstrate:

1. Applicant registration and login using email and password, with
    passwords securely hashed.
2. Application creation, private document upload, and submission.
3. OCR/document understanding separated from business verification,
    with stored confidence and a human-verification gate below the
    configured threshold (90% by default).
4. Low-confidence OCR is held from automatic routing until authorized
    human verification; passing or verified documents continue through
    broader document understanding.
5. Backend Department routing using broader relevant application and
    document content.
6. Atomic, concurrency-safe, least-pending assignment within the routed
    Department, or explicit `WAITING_FOR_OFFICER`.
7. Officer case review and adverse/uncertain-case escalation without
    OCR/AI inspection or missing-field AI warnings.
8. Authorized human verification of low-confidence documents is
    separate from the General Officer's open escalation decision set.
9. General Officer receives Officer-escalated cases and may approve or
    reject them with a required rejection reason.
10. Deadline and breach visibility with text labels.
11. Single global Admin organization-wide views, subject to the
    approved Admin authentication and authorization policy.
12. Preserved application/document history and audit events.
13. An assigned Officer explicitly starts review before an application
      enters `UNDER_REVIEW`.

## 12. Technology Direction

The frontend foundation proposes React with TypeScript and Vite. This is
a proposed technology choice, not a product requirement. Backend,
database, email delivery, private file storage, OCR, and
document-understanding technologies remain implementation choices
subject to the architecture, privacy, and security requirements.

## 13. Open Decisions

The following must be resolved or explicitly configured before the
relevant production implementation:

- Admin email-token purpose/lifetime, whether it is for activation,
  login, or password setup, whether Admin also has a password, and
  token recovery/reset behavior;
- Production Officer setup-email provider and delivery/retry policy.
  The Officer Dashboard provides an owner-scoped password-setup action
  after approval. Production approval fails safely until an email sender
  is configured;
- whether Officers may directly approve non-adverse cases; until
  approved, do not add direct Officer final-decision behavior;
- exact General Officer action set and any correction/additional-
  information or resubmission workflow;
- Applicant password/account recovery behavior, if required;
- Department-classification/routing algorithm, routing confidence
  threshold, and authorized fallback for uncertainty (separate from
  the configured OCR confidence threshold);
- provisioning/grant mechanism for the dedicated human-verification
  permission;
- exact deadline/SLA rules, grace period, consequences, and notification
  behavior;
- if correction/resubmission is approved, how it re-enters
  verification/routing and whether reassignment is required;
- exact notification channels, retries, and message policy;
- Admin management operations and their authorization scope;
- retention and deletion policy for documents, OCR results, and audit
  data.

Open decisions are not permission to invent behavior. Technical
implementation details may be selected by the responsible developer
only where they do not settle a product/security decision above.

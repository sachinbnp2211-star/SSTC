# HacKBios Product and Engineering Rules

## 1. Source of Truth

The six documents in `docs/` describe one system. The PRD contains
product requirements; this file states non-negotiable workflow and
security rules. Do not restore obsolete behavior from old documents or
code. If a decision is unresolved, preserve it as an open decision
rather than silently inventing behavior.

## 2. Applicant Authentication

1. Applicant registration and login use email and password.
2. Securely hash passwords; never store or log them in plaintext.
3. No Applicant OTP registration, OTP verification, OTP challenge, or
   OTP-based login is part of the current requirements.
4. No additional Applicant email-verification step is defined.

## 3. Organization and Officer Provisioning

1. The organization has 10 Departments, 15 government Officers per
   Department, 150 Officers total, and exactly one global Admin.
2. Represent organization size as data/configuration; do not hard-code
   staffing totals into frontend behavior.
3. Every Officer has one unique government Officer ID and exactly one
   Department association.
4. Self-registration must match an active Government Officer Registry
   identity, including its registered name and official email.
5. Derive Department from the registry; never accept an Officer-selected
   Department for this flow. Registry identities and User accounts are
   separate; seeding identities must not provision accounts.
6. New Officer and General Officer registrations are `PENDING` and cannot authenticate until the
   existing Admin approves them. Approval/rejection requires the
   existing Admin `USER_MANAGE` permission; rejection requires a reason.
7. One Government Officer ID may have only one User account. Pending and
   active registrations cannot be duplicated; a rejected account may be
   resubmitted without creating a second account.
8. Approval rechecks active registry/Department state, activates only a
   pending account, and creates a 24-hour, single-use password setup
   token. Store only its hash. The existing email boundary must deliver
   the link. Status lookup may identify an entry using Government
   Officer ID but returns only minimal status information. Registration
   also issues an expiring, random credential whose hash alone is stored;
   password setup requires that credential as well as the matching ID,
   and only after Admin approval. Never expose the setup URL through
   Admin APIs or UI.
9. Department Officers log in using their Government Officer ID or
   registered email. General Officers log in using their Government
   Officer ID only. Their registry email and Department are not
   applicant-selected. Setup requires password confirmation, hashes the chosen
   password with bcrypt, consumes the setup token, and clears
   `mustChangePassword` and the registration status credential. Knowing
   a Government Officer ID alone must never authorize password setup or
   grant staff application permissions. Admin staff provisioning must
   not bypass registration approval for either role.
10. Passwords and one-time setup tokens must never be returned, logged,
    hard-coded, or stored in plaintext. Return the random registration
    status credential only to the officer-registration submitter; store
    only its hash. Do not use a development fallback in production.
11. No external government identity provider or real identity data is
    implied. Synthetic demo registry identities use reserved
    `example.test` email addresses.

## 4. OCR, Verification, Routing, and Assignment

These responsibilities must remain separate:

- OCR/document understanding extracts text/data and preserves
  processing results.
- Backend business logic performs verification.
- Backend routing selects the Department using broader relevant
  application and document-understanding content.
- Backend assignment selects the Officer after Department routing.
- The frontend performs none of these decisions.

OCR must not approve/reject, make final business-rule decisions, make
the final Department routing decision, or assign Officers. OCR results
are evidence, not authority.

Routing must not rely only on one isolated field when broader relevant
content is available. Routing uncertainty must follow an explicit
fallback, not a silent guess.

### OCR confidence gate and human verification

- Calculate and store an OCR confidence percentage for every processed
  document. Backend configuration/environment provides one
  `OCR_THRESHOLD`, default `90`; do not duplicate it as a magic number.
- A score equal to or above the configured threshold may continue through
  the normal OCR gate. A below-threshold score remains `LOW_CONFIDENCE`;
  the OCR threshold is never lowered or bypassed.
- After OCR succeeds and usable text is present, a configurable AI
  document-quality assessment runs once for below-threshold documents
  before existing fallback checks. It assesses OCR evidence; it does not
  generate replacement OCR text. OCR failure is never overridden, and
  unusable text is never sent to AI.
- Scores below `OCR_QUALITY_HARD_MINIMUM` (default 50%) always enter
  Human Verification. Between that minimum and
  `OCR_QUALITY_MODERATE_FLOOR` (default 60%), require the stronger
  quality/completeness/noise limits and exact evidence for all expected
  fields. From the moderate floor to `OCR_THRESHOLD`, require readable
  text, safe and consistent AI assessment, quality score at least 0.85,
  verified field completeness at least 0.80, and acceptable OCR noise.
  At or above `OCR_THRESHOLD`, the quality/readability/noise checks still
  apply before the existing classification path.
- Document-specific expected-field profiles are extensible; Health and
  Income Certificates have separate profiles. Verified completeness is
  calculated deterministically from clear field values, minimum field
  confidence, and exact evidence contained in OCR. The model's reported
  completeness does not substitute for this calculation. Model
  confidence is not calibrated and cannot replace exact evidence.
- Unsupported low-confidence types, missing or uncertain fields,
  malformed/unavailable assessments, inconsistent results, and
  processing failures must enter Human Verification. The configured OCR
  threshold is never lowered or bypassed.
- OCR confidence is extraction reliability, not Department-routing
  confidence. Preserve broader document understanding for Department
  routing after the OCR gate.
- Applicants may see their own document's OCR status, confidence, and
  verification-required state, but never extracted OCR text. Original
  file access is ownership-checked; pending originals may also be
  accessed only by an authorized `GENERAL_OFFICER` or `HUMAN_VERIFIER`
  with `HUMAN_VERIFY_OCR`.
- Only an authenticated, backend-authorized `GENERAL_OFFICER` or
  `HUMAN_VERIFIER` with the dedicated `HUMAN_VERIFY_OCR` permission may
  access the queue, OCR output, or private original for verification.
  Ordinary Officer permissions and screens must not expose this
  processing-stage interface.
- A verifier may verify or reject and record a note/reason. Persist
  verifier identity/time/status and append an audit event atomically
  with a conditional `PENDING`-status update so concurrent decisions
  cannot both succeed. Do not put OCR text or secrets in logs.
- Verified documents continue to understanding and backend routing.
  Rejection is passed to the existing rejection/escalation workflow;
  this rule does not define an application-state transition.
- Never expose original documents through public URLs. Authorize every
  retrieval at the backend.

## 5. Officer Rules

Officers may view application information and authorized original
documents within their authenticated Department scope, review OCR and
Human Verification results, and record review notes. During review,
they may approve, reject with a reason, or escalate with a reason to a
General Officer.

An application enters `UNDER_REVIEW` from `ASSIGNED` only when an
authorized Officer performs the explicit **Start Review** operation.
Reading or opening application details does not start review. Each
decision records the authenticated Officer and timestamp.

Officer interfaces and permissions must not provide:

- OCR/AI inspection controls or AI confidence controls;
- direct OCR manipulation;
- missing-field AI warnings;
- unauthorized document-validation logic;
- decisions without the required rejection or escalation reason.

Approval, rejection, and escalation are persisted as Officer review
outcomes. A General Officer may resolve an escalated application by
approving it or rejecting it with a reason; both decisions record the
authenticated reviewer and timestamp.

## 6. General Officer and Correction Rules

1. General Officer handles cases escalated by Officers and may approve
   or reject them. Rejection requires a reason.
2. General Officer decisions apply only to applications in `ESCALATED`;
   resolved cases cannot be decided again.
3. Escalation preserves application ID, originating Officer, reason,
   timestamp, status, application/document versions, and audit history.
4. Never overwrite or delete the original Officer action, submission,
   document version, or earlier decision.
5. General Officer decision identity, timestamp, decision, and reason
   are persisted separately from the originating Officer's review.
6. Correction/resubmission behavior and its notification remain
   **OPEN**. Do not add those actions without explicit approval.
7. Do not infer re-routing/reassignment after any future correction.

## 7. Assignment Rules

After backend routing selects a Department:

1. Consider only eligible Officers of that Department.
2. Pending assignment workload counts exactly `ASSIGNED` and
   `UNDER_REVIEW`.
3. Do not count `DRAFT`, `SUBMITTED`, `PROCESSING`, `ROUTED`,
   `WAITING_FOR_OFFICER`, `WAITING_FOR_OFFICER_ASSIGNMENT`, `ESCALATED`, `CORRECTION_REQUIRED`,
   `RESUBMITTED`, `APPROVED`, or `REJECTED`.
4. Choose the eligible Officer with the least pending workload.
5. For equal counts, choose the Officer whose most recent assignment
   across application history is oldest first (never assigned sorts
   first), then stable User ID ascending.
6. Serialize workload selection and assignment with the Department's
   database lease lock so concurrent submissions cannot use stale
   workload counts. Recheck that the application is still eligible while
   holding the lock.
7. If no eligible Officer is available, use `WAITING_FOR_OFFICER_ASSIGNMENT`.
   Never silently assign to another Department.

## 8. Deadline Rules

- Applications requiring processing have a deadline.
- Show deadline, remaining time where applicable, and breached/overdue
  status as clear text; do not rely on color alone.
- Deadline breach is independent of application status.
- Do not invent SLA duration, grace period, post-breach consequence, or
  notification rules before approval.

## 9. Security and Privacy Rules

1. Backend authorization is mandatory for every protected action and
   original-document access. Frontend routing is not a security
   boundary.
2. Sensitive original documents remain private; no public document
   URLs.
3. Store original documents separately from OCR/document-understanding
   results.
4. Never store or log plaintext passwords, setup/reset tokens,
   Admin tokens, or secrets.
5. Securely hash passwords and persisted verification tokens.
6. Never hard-code credentials, API keys, or tokens.
7. Validate all input and apply authentication abuse controls.
8. Use secure transport and least-privilege authorization.
9. Do not send sensitive documents to an external OCR/AI provider
   without approval of that provider and data flow.
10. Audit important actions without placing secrets or unnecessary
    document contents in logs.

## 10. Admin Rules

- There is exactly one global Admin with authorized organization-wide
  scope.
- Admin can view/manage Departments, Officers, applications,
  deadlines/breaches, and audit information only within approved
  permissions.
- Admin authentication uses an email-based token-link concept:
  Admin email → token generated → email sent → link opened → token
  validated → authentication/activation action.
- Token purpose, lifetime, password relationship and recovery/reset
  behavior remain **OPEN**. Do not infer them.

## 11. State and History Rules

Application states:

```text
DRAFT
SUBMITTED
PROCESSING
OFFICER_REVIEW
ROUTED
WAITING_FOR_OFFICER
ASSIGNED
UNDER_REVIEW
ESCALATED
GENERAL_OFFICER_REVIEW
CORRECTION_REQUIRED
RESUBMITTED
APPROVED
REJECTED
```

Every transition is validated server-side and recorded with actor,
timestamp, relevant version, and safe rationale. The list above is the
canonical application-state vocabulary. Deadline breach is a
property/event, not a state. Applicant applications move from `DRAFT` through `SUBMITTED` and
`PROCESSING` to `OFFICER_REVIEW` only after OCR completes and any
required Human Verification is complete. The `ASSIGNED →
UNDER_REVIEW` transition is caused only by explicit Start Review from
the currently assigned Officer; viewing the application is not a
transition. A General Officer may approve or reject an `ESCALATED`
application; rejection requires a reason. Applicant
correction/resubmission remains **OPEN**.
Application history and prior documents are never overwritten.

## 12. Implementation Rules

- Backend is authoritative; frontend never accesses the database
  directly.
- Keep frontend role-specific pages separated from reusable UI.
- Use mock data only when explicitly identified as demo behavior; mock
  authentication must never be represented as production security.
- Do not invent permanent API endpoints before the API contract is
  agreed.
- Keep API/service calls isolated from presentation.
- Never commit `.env` secrets or generated sensitive data.

## 13. Coding-Agent Rules

Before coding, read `PRD.md`, `ARCHITECTURE.md`, `RULES.md`,
`PHASES.md`, `DESIGN.md`, and `MEMORY.md`. Keep all six synchronized
when product requirements change. If a requirement is unclear, identify
it as an open decision and do not implement assumed behavior.

## 14. Git Rules

- `main` is the stable branch; `develop` is the integration branch.
- Use feature branches for individual work; PRs target `develop`.
- Do not commit secrets.
- Keep documentation synchronized with implementation.

## 15. Change Rule

For a product requirement change, update the PRD, Architecture, Rules,
Phases, Design, and Memory together. These six documents must describe
one internally consistent system.

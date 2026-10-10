# HacKBios frontend

Phase 1 provides role-separated, responsive UI foundations for the HacKBios
applicant, Officer, General Officer, and Admin areas.

## Technology

React + TypeScript + Vite, following the proposed frontend choice in the
project foundation. React Router is used for role-based page routes.
Authentication connects to the backend's `/api/auth` endpoints; application
and processing workflows remain isolated browser demos.

## Run locally

```sh
npm install
npm run dev
```

Validate the production build and lint:

```sh
npm run build
npm run lint
```

The Vite development server proxies `/api` to `http://localhost:4000`.
Set `VITE_API_URL` when the backend is hosted at a different API URL.

## Page areas

- Applicant: landing, registration, email/password login, application list,
  application creation/review, and application details.
- Officer: Government Officer ID registry lookup and pending self-
  registration, login, assigned-application queue, deadline/search/filter
  view, and application details with the documented escalation action.
- General Officer: login, escalated-case queue, and case details with a
  placeholder instead of undecided decision actions.
- Admin: email-link entry UI and global overview placeholders.

The exact paths are declared in `src/App.tsx`.

## Mock boundary

Applicant application create/list/detail/submission uses the authenticated
backend API and MongoDB. Officer and General Officer queue/actions, document
verification, document selection/upload, and notification sample data remain
isolated in
[`src/services/mockApi.ts`](./src/services/mockApi.ts). This module is not an
API client and defines no permanent backend endpoints. Its state exists only
in browser memory and resets on refresh. Selected documents are not uploaded;
document-selection UI is not connected to the persistent application API.

Login and registration use the backend authentication API. A JWT and the
backend-returned safe user profile are stored in browser local storage; on
reload, the frontend verifies the session through `/api/auth/me`. Sign out
revokes the active JWT through `/api/auth/logout` and clears the local session.
Route guards improve UX only: backend authorization is the security boundary.
Authentication does not make the application or processing demo data
production data for the still-mocked staff, notification, and document
workflows.

The sample application fields and status data are explicitly illustrative.
This frontend does not implement OCR, document understanding, or department
classification.

## Product constraints

The six files in [`../docs/`](../docs/) are authoritative. The frontend
intentionally has no OTP flow, no Officer OCR/AI inspection, no
missing-field-warning UI, and no Officer correction-request UI. It does not
define deadline SLAs, breach consequences, Admin token purpose/lifecycle, or
General Officer decision actions.

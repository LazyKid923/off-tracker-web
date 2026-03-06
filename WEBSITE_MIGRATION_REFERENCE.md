# Off Tracker Website Migration Reference

## 1. Objective
Convert the current Google Sheets + Apps Script Off Tracker into a production-grade web application while preserving all existing behavior:
- Personnel-scoped tracking of off grants and usage.
- Allocation logic across one or more grant IDs.
- Edit/delete/undo workflows with audit trail.
- Dashboard totals and monthly calendar visualization.
- Protection/recovery behavior currently handled by sheet locks/backups.

This document is based on the implemented behavior in:
- `Code.js`
- `README.md`
- `useoff_rendered.html`

## 2. Current System (As-Built)

### 2.1 Data Surfaces
Current sheets and roles:
- `Dashboard`: selected personnel + totals (granted, used, remaining)
- `Offs (Granted)`: grant records (`G-xxxx`) with duration, reason, balances, status
- `Offs (Used)`: usage records (`U-xxxx`) with session, duration, and grant allocation text
- `Calendar`: month selector + Monday-first month grid with chips for granted/used
- `Personnel`: personnel list
- `Edit Logs`: audit records (`L-xxxxx`) for edit/delete/undo actions
- Hidden backups: `__BKP_GRANTED__`, `__BKP_USED__`, `__BKP_CALENDAR__`, `__BKP_LOGS__`

### 2.2 Existing Functional Rules (Must Preserve)

#### Personnel
- Must always have at least one personnel.
- Add personnel: unique (case-insensitive), non-empty.
- Delete personnel:
- If related grant/use/log rows exist, deletion is blocked unless `deleteData=true`.
- Optional cascading delete removes related grant/use/log rows.

#### Add Off Grant
- Date required (strict `YYYY-MM-DD` parser).
- Duration: `FULL=1`, `HALF=0.5`.
- Reason:
- `OPS`: weekend duty date required and must be Sat/Sun; auto reason details `Weekend Ops on YYYY-MM-DD`; default `providedBy="Yourself"` if blank.
- `OTHERS`: requires `otherDetails` and `providedBy`.
- New row initializes `used=0`, `remaining=duration`, `status=Unused`.
- IDs are generated as `G-<4-digit>` based on row position.

#### Use Off
- Date required.
- Session: `FULL=1`, `AM=0.5`, `PM=0.5`.
- At least one selected `G-` ID required.
- Selected IDs must exist for selected personnel and have remaining balance.
- Selected total remaining must cover requested duration.
- Allocation consumes selected IDs in submitted order until requirement is met.
- Per affected grant, update:
- `used += allocation`
- `remaining -= allocation`
- `status` becomes `Used` or `Partial`.
- Create usage row `U-<4-digit>` with `Off IDs Used` string like `G-0001 (0.5) + G-0002 (0.5)`.

#### Edit Off Grant
- Exactly one `G-` record selected.
- Cannot reduce duration below already used value.
- Same reason validations as add flow.
- Recompute `remaining = duration - used` and status (`Unused` / `Partial` / `Used`).
- Append audit log action `EDIT_GRANTED` with before/after snapshots.

#### Delete Off Grant
- Batch delete supported.
- Only grants with `used == 0` are deletable.
- Append audit log action `DELETE_GRANTED`.

#### Edit Off Used
- Exactly one `U-` record selected.
- Parse existing allocation string into `(grantId, amount)` allocations.
- If target duration increases:
- require additional IDs (if needed) and allocate from their remaining balances.
- If target duration decreases:
- release allocation from the end of current allocation list.
- Persist updated allocation string.
- Update touched grants’ used/remaining/status.
- Append audit log action `EDIT_USED`.

#### Undo Off Used
- Parse usage allocations.
- Restore each allocated amount back to corresponding grants.
- Delete usage row.
- Append audit log action `UNDO_USED`.

#### Dashboard + Calendar
- Dashboard totals are personnel-scoped:
- total granted = sum of grant duration
- total used = sum of usage duration
- balance = sum of grant remaining
- Calendar:
- Monday-first grid
- selectable month from next 24 months
- shows chips `+x` (granted) and `-x` (used)
- half-day used chip includes `(AM)` or `(PM)` when applicable
- color coding for granted-only / used-only / both

#### Protection / Recovery / Integrity
- Managed sheets are protected against manual edits.
- Structural changes trigger restore from hidden backups.
- Calendar B2 and Dashboard personnel selector are allowed edit points.
- Backup sync occurs after key operations.

#### Audit Logging
- Actions logged with: log ID, timestamp, action, personnel, record type/id, summary, before/after JSON, editor email.
- Current action types: `EDIT_GRANTED`, `DELETE_GRANTED`, `EDIT_USED`, `UNDO_USED`.

## 3. Target Web Architecture

## 3.1 Recommended Stack
- Frontend: Next.js (App Router) + TypeScript + React Query + React Hook Form + Zod
- Backend API: NestJS or Fastify (TypeScript)
- Database: PostgreSQL
- ORM: Prisma (or Drizzle)
- Auth: Clerk/Auth0/NextAuth with SSO-ready design
- Infra: Vercel (frontend) + Render/Fly/AWS for API + managed Postgres

Why this stack fits:
- TypeScript end-to-end for fast parity implementation.
- Strong form validation and shared schemas between FE and BE.
- PostgreSQL transactions support precise allocation/undo integrity.
- Easy team parallelization (FE/BE/DevOps/QA).

## 3.2 System Boundaries
- Frontend handles presentation, client-side validation, and workflow state.
- Backend owns all business rules and final validation.
- Database is source of truth for grants/usage/allocations/audit.

## 4. Backend Requirements

### 4.1 Data Model (Minimum)

`personnel`
- `id` (uuid, pk)
- `name` (unique, case-insensitive)
- `is_active` (bool)
- `created_at`, `updated_at`

`off_grants`
- `id` (uuid, pk)
- `grant_code` (`G-0001`, unique)
- `personnel_id` (fk)
- `granted_date` (date)
- `duration_value` (numeric(3,1), allowed 0.5 or 1.0)
- `reason_type` (`OPS` | `OTHERS`)
- `weekend_ops_duty_date` (date, nullable)
- `reason_details` (text)
- `provided_by` (text)
- `used_value` (numeric(4,1), default 0)
- `remaining_value` (numeric(4,1))
- `status` (`UNUSED` | `PARTIAL` | `USED`)
- `created_at`, `updated_at`, `created_by`, `updated_by`

`off_usages`
- `id` (uuid, pk)
- `usage_code` (`U-0001`, unique)
- `personnel_id` (fk)
- `intended_date` (date)
- `session` (`FULL` | `AM` | `PM`)
- `duration_used` (numeric(3,1), 0.5 or 1.0)
- `comments` (text)
- `created_at`, `updated_at`, `created_by`, `updated_by`

`off_usage_allocations`
- `id` (uuid, pk)
- `usage_id` (fk)
- `grant_id` (fk)
- `amount` (numeric(3,1))
- `allocation_order` (int)

`edit_logs`
- `id` (uuid, pk)
- `log_code` (`L-00001`, unique)
- `timestamp`
- `action`
- `personnel_id` (nullable fk)
- `record_type`
- `record_id`
- `summary`
- `before_json` (jsonb)
- `after_json` (jsonb)
- `edited_by` (user id/email)

`users` (if not delegated fully to external auth)
- `id`, `email`, `display_name`, `role`

### 4.2 Business Logic Rules
Implement all workflow logic in service layer methods wrapped in DB transactions:
- `addGrant()`
- `useOff()`
- `editGrant()`
- `deleteGrant(s)`
- `editUsage()`
- `undoUsage()`
- `deletePersonnel()`

Critical transaction rules:
- Lock all grant rows being read/updated for allocation (`SELECT ... FOR UPDATE`).
- Re-check remaining balances server-side before commit.
- Fail entire transaction on any inconsistency.
- Use decimal-safe arithmetic (no float drift).

### 4.3 API Requirements (Core)
- `GET /personnel`
- `POST /personnel`
- `DELETE /personnel/:id?deleteData=true|false`
- `GET /dashboard?personnelId=...`
- `GET /grants?personnelId=...`
- `POST /grants`
- `PATCH /grants/:grantId`
- `DELETE /grants` (batch by IDs)
- `GET /usages?personnelId=...`
- `POST /usages` (use off)
- `PATCH /usages/:usageId` (edit usage)
- `DELETE /usages/:usageId/undo`
- `GET /calendar?personnelId=...&month=YYYY-MM`
- `GET /logs?personnelId=...&action=...&page=...`

Response requirements:
- Standard `{ ok, data, message, errors }` envelope.
- Return deterministic validation messages mirroring current behavior where possible.

### 4.4 Security / Permissions
- Require authenticated users for all endpoints.
- Role model:
- `ADMIN`: manage personnel + destructive actions
- `EDITOR`: add/use/edit/undo grants/usages
- `VIEWER`: read-only dashboard/calendar/logs
- Every mutation writes immutable audit logs.

### 4.5 Backup / Recovery Replacement
Replace sheet backup tabs with platform-appropriate controls:
- Daily managed Postgres backups + PITR.
- Optional append-only event table for recovery and forensic replay.
- Soft-delete where practical (`deleted_at`) except explicit undo flows.

## 5. Frontend Requirements

### 5.1 Core Screens
- `/dashboard`
- Personnel selector + totals cards + quick actions
- `/grants`
- table with filters, status badges, add/edit/delete dialogs
- `/usage`
- table with add use flow + edit/undo dialogs
- `/calendar`
- month picker + Monday-first calendar + legend + chips
- `/personnel`
- add/delete personnel + cascade delete confirmation UX
- `/logs`
- searchable audit log view with before/after diff drawer

### 5.2 Workflow UX Parity
- Preserve the current modal-driven workflows for familiarity.
- Enforce client-side validation that matches backend rules.
- Show selection helper text in use/edit flows:
- selected total vs required duration
- additional required duration when editing usage upward
- Disallow submit while request is in flight.
- Confirm destructive actions (delete/undo).

### 5.3 Data Handling
- Use server state caching keyed by selected personnel.
- Invalidate and refetch dashboard/calendar/grants/usages after successful mutations.
- Do not rely on optimistic updates for allocation mutations; use server-confirmed refresh.

### 5.4 Visual Rules to Preserve
- Grant status color semantics (`Unused/Partial/Used`).
- Calendar colors for granted-only, used-only, both.
- Session visibility for half-day chips (`AM`/`PM`).

## 6. Parity Mapping (Current -> Web)
| Current behavior | Website implementation |
|---|---|
| Sheet dropdown for personnel | Global personnel selector in app header or dashboard |
| Modal dialogs in Apps Script | React modal components with same form fields |
| `Off IDs Used` text parsing | Normalized allocation table + computed display string |
| Sheet protections | RBAC + server-side validation + immutable audit logs |
| Hidden backup sheets | Managed DB backups + transactional integrity |
| Spreadsheet filters per personnel | Backend query filters + table filter controls |
| Calendar rendering in sheet cells | Client-rendered month grid with API-fed aggregates |

## 7. Migration / Delivery Plan

### Phase 1: Foundation
- Create monorepo (`apps/web`, `apps/api`, `packages/shared`).
- Setup CI, linting, formatting, test harness.
- Provision Postgres + environments (dev/staging/prod).

### Phase 2: Data + Backend Core
- Implement schema + migrations.
- Implement personnel, grants, usage, allocations, logs services.
- Add transactional tests for allocation/edit/undo edge cases.

### Phase 3: Frontend Core
- Build dashboard, grants, usage screens.
- Implement modal workflows and form validation.
- Integrate role-based route/action guards.

### Phase 4: Calendar + Logs + Hardening
- Implement calendar aggregation endpoint and UI.
- Implement logs page with searchable audit trail.
- Add observability (request logs, error reporting, metrics).

### Phase 5: Data Migration
- Export existing sheets.
- Build import script mapping sheet columns -> DB tables.
- Reconcile totals/personnel parity checks.

### Phase 6: UAT + Cutover
- Parallel-run validation with existing sheet for sample period.
- Sign-off on parity checklist.
- Production cutover and read-only freeze on sheet tracker.

## 8. Team Role Breakdown

### Product/PM
- Own parity acceptance criteria.
- Confirm edge-case behavior and UX copy parity.
- Drive UAT and launch sequencing.

### Tech Lead
- Finalize stack and architecture decisions.
- Approve transactional design and code conventions.
- Coordinate FE/BE contract and release readiness.

### Backend Engineer(s)
- Build schema, services, APIs, and transaction-safe allocation logic.
- Implement audit logging and RBAC checks.
- Deliver migration import/reconciliation scripts.

### Frontend Engineer(s)
- Build pages/modals/tables/calendar and validation UX.
- Integrate API and caching strategy.
- Ensure accessibility and responsive behavior.

### QA Engineer
- Build parity test matrix from Section 2.2 rules.
- Validate edge cases (insufficient balances, invalid weekends, undo correctness, role restrictions).
- Run regression tests before cutover.

### DevOps Engineer
- Provision environments, CI/CD, secrets, monitoring.
- Configure backup/restore policies and operational runbooks.

## 9. Acceptance Criteria (Launch Gate)
- All workflows in Section 2.2 pass parity tests.
- Allocation math is transaction-safe under concurrent usage attempts.
- Audit logs are generated for all mutations and cannot be edited by non-admin users.
- Dashboard and calendar totals match backend aggregates for sampled personnel/months.
- Backup/restore process is documented and tested.

## 10. Known Design Decisions to Confirm Early
- Whether `grant_code` / `usage_code` must remain strictly sequential with no gaps.
- Whether calendar month options should remain “next 24 months” or become open-ended.
- Whether personnel deletion should hard-delete or soft-delete related rows when cascading.
- Whether to keep exact historical message text from Apps Script responses.

## 11. Suggested Next Execution Order
1. Approve stack + DB schema + API contract.
2. Implement backend transactions and unit/integration tests first.
3. Build frontend workflows against stable API.
4. Run migration dry-run using exported sheet data.
5. Perform parity UAT and cutover.

# Architecture Document — LeaveTrack v1.0

Traces to: `docs/prd/PRD-LeaveTrack-v1.0.md`

## Stack

- **Frontend/Backend:** Next.js 16 (App Router), TypeScript.
- **Database:** Postgres via Supabase.
- **Auth (Day 0):** mock cookie session — see `ADR-LeaveTrack-E001`. Day 1 provider is TBD — see `ADR-LeaveTrack-E003`.
- **Deployment target:** Vercel (app), Supabase (managed Postgres).

Rationale: the team already runs Next.js + Supabase on other projects (fits nexus's Day 0 mock-auth-mock-data pattern directly); no NFR here demands anything heavier.

## Data Model

```
users            (id, name, email, role[employee|manager|hr_admin], manager_id nullable FK -> users.id)
leave_types      (id, name, tracks_balance boolean)          -- seeded: Vacation, Sick, Unpaid
leave_policies   (id, user_id FK, leave_type_id FK, accrual_per_month numeric)
leave_balances   (id, user_id FK, leave_type_id FK, balance numeric, updated_at)
leave_requests   (id, user_id FK, leave_type_id FK, start_date, end_date, reason,
                  status[pending|approved|rejected], decided_by FK -> users.id nullable,
                  decided_at nullable, is_deleted boolean default false, created_at)
audit_log        (id, leave_request_id FK, actor_id FK, action, occurred_at)
accrual_ledger   (id, user_id FK, leave_type_id FK, period date, days numeric, created_at,
                  unique (user_id, leave_type_id, period))
```

- `accrual_ledger` is the authoritative monthly accrual marker (one row per user/type/month) and the
  source of `lastAccruedAt`. `leave_balances.updated_at` cannot serve that role because any balance
  write (an approval, for example) moves it.

- `leave_requests.is_deleted` — **soft delete only**, per BR-04 (3-year retention). No hard-delete path exists anywhere in the codebase.
- `users.manager_id` is the sole source of truth for the scoped-visibility rule (US-04). A manager's queue query always filters `WHERE manager_id = :current_user_id`.

## API Design (selected)

| Method | Route                            | Auth          | Notes                                                          |
| ------ | -------------------------------- | ------------- | -------------------------------------------------------------- |
| POST   | /api/leave-requests              | Employee      | US-01. Validates date range server-side (AC2).                 |
| GET    | /api/leave-requests?scope=mine   | Employee      | US-02 balance context.                                         |
| GET    | /api/leave-requests?scope=team   | Manager       | US-04 — server-side filter on `manager_id`, never client-side. |
| POST   | /api/leave-requests/:id/decision | Manager       | US-03. 403 if requester is not a direct report (AC3).          |
| GET    | /api/audit/:userId               | HR Admin      | US-05. Reads soft-deleted-excluded, never hard-deleted, rows.  |
| POST   | /api/jobs/accrual                | System (cron) | US-07. Idempotent — see ADR-LeaveTrack-E002.                   |

Error format: `{ success: false, error: { code, message } }` on every non-2xx response, per AGENTS.md convention.

## Security

- Every manager-scoped endpoint enforces the `manager_id` filter in the query itself, not in application logic that could be bypassed — this is the direct implementation of PRD NFR "enforced server-side, never client-side only."
- Session cookies are issued by Supabase Auth through `@supabase/ssr`: httpOnly, `SameSite=Lax`, `Secure` in production. `proxy.ts` refreshes them on every matched request.
- Authorization is **RBAC + relationship-based scoping** (`ADR-LeaveTrack-E004`): roles gate actions, `users.manager_id` gates records, and scope is always a SQL predicate.

## Deployment Topology

- Single Next.js app on Vercel, single Supabase Postgres instance (pooled connection, not direct).
- Monthly accrual job (US-07) runs as a scheduled Vercel Cron hitting `/api/jobs/accrual`.

## Epic 2 — Production Readiness & Flow Completion

Traces to: `docs/prd/PRD-LeaveTrack-v1.0.md` (US-01 AC1/AC3, US-03, US-05), `docs/brd/BRD-LeaveTrack-v1.0.md` (BR-02, BR-04), `ADR-LeaveTrack-E001` (Consequences), and the resolved Open Questions below.

### Goal

Epic 1 delivered the core submit → balance → scoped queue → decision → audit → accrual flow. Epic 2 closes the Day 0/Day 1 scaffold gaps so the app is production-ready before the Q3 audit: replace mock auth and the remaining mock-backed screens, complete the notification/override/compliance acceptance criteria, and harden authorization, scale, and tests.

### Workstreams

1. **Identity and authorization** — real provider (`ADR-E003`), DB-backed identity, centralized RBAC + relationship scoping (`ADR-E004`), DB-level enforcement decision.
2. **Complete the DB-backed surface** — `/requests`, `/requests/[id]`, dashboard, HR override view, policy and people admin.
3. **Close PRD acceptance gaps** — submission/decision notifications, HR over-balance override, audit date-range and export.
4. **Scale and hardening** — pagination and indexes, 800-user load test, route-level authorization tests, fixture reset, accrual-ledger append-only guard, DB-down states, nonce-based CSP.

### Auth (accepted — E2-02)

Supabase Auth is the accepted provider (`ADR-LeaveTrack-E003`) and is implemented with `@supabase/ssr`. Sign-in, sign-out, `/auth/callback`, session refresh in `proxy.ts`, and the verified-email-to-`users` mapping are live. The former `mock-role` / `mock-user` / `mock-email` cookies are removed.

- `proxy.ts` is an authentication gate only. It verifies the provider session with `auth.getClaims()` and copies refreshed cookies onto the response; it makes no authorization decisions.
- `getSession()` requires a confirmed provider email, maps it case-insensitively to exactly one `users` row, and returns that row's role and name.
- An authenticated identity with no `users` row is signed out. Provider claims are never an authorization source.
- Missing auth configuration fails closed: protected pages redirect to `/login`, protected APIs return `503 SERVICE_UNAVAILABLE`.
- Identity mapping uses the existing `users_email_lower_unique` index. A stable `auth_subject` column is deferred until email changes must be supported.

### Authorization model

The app uses **RBAC + relationship-based scoping**, not RBAC alone. See `ADR-LeaveTrack-E004`.

- Roles (`employee`, `manager`, `hr_admin`) gate the _kind_ of action.
- `users.manager_id` gates _which records_ a manager may act on.
- Resource scope is always a SQL predicate (`WHERE employee.manager_id = :current_user_id`), never a client-side filter.
- The DB `users.role` is the source of truth; neither a provider claim nor a cookie role is trusted for authorization.
- All page and route authorization checks call the pure `lib/auth/policy.ts` matrix (an `Actor` of DB `id` + `role` plus the record's scope). `lib/auth/access.ts` was deleted in E2-03; only the fixture-backed pages still use mock actors until E2-05.
- HR override is a separate audited action, not a blanket "HR can do anything."

| Action                  | Employee  | Manager                   | HR Admin                        |
| ----------------------- | --------- | ------------------------- | ------------------------------- |
| Submit/view own request | Yes — own | Yes — own                 | Yes — own                       |
| View team requests      | No        | Yes — direct reports only | Yes — all (override)            |
| Decide pending request  | No        | Yes — direct reports only | Yes — override, reason required |
| Run audit report        | No        | No                        | Yes                             |
| Configure policies      | No        | No                        | Yes                             |
| Run accrual job         | No        | No                        | No — system bearer only         |

### ADRs

- `ADR-LeaveTrack-E002` — accrual idempotency (referenced by this document; added in Epic 2).
- `ADR-LeaveTrack-E003` — auth provider (accepted: Supabase Auth; implemented by E2-02).
- `ADR-LeaveTrack-E004` — authorization model (RBAC + relationship scoping).

### Sequencing

1. **2.1 — Trust the identity:** E2-01 → E2-02 → E2-03 → E2-04; E2-20/E2-21 docs reconciliation.
2. **2.2 — Finish the flow:** E2-05 → E2-06 → E2-10 → E2-07 → E2-11.
3. **2.3 — Admin and compliance:** E2-08 → E2-09 → E2-12.
4. **2.4 — Scale and hardening:** E2-13 → E2-14 → E2-15 → E2-16 → E2-17 → E2-18 → E2-19.

### Out of scope

Payroll integration, multi-country holiday calendars, biometric attendance, native mobile apps, Slack/Teams, employee self-service policy changes, multi-tenancy, and BI dashboards. Employee request cancellation is a future product decision (not in PRD v1.0).

## Open Questions

- ~~Should `leave_policies` support mid-year policy changes (e.g., a promotion changing accrual rate)?~~ **Resolved in Epic 2 (E2-08):** effective-dated policy rates; the accrual job uses the rate effective for the run period.
- Which provider replaces the mock cookie? **Open — `ADR-LeaveTrack-E003` (E2-01).**

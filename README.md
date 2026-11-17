# LeaveTrack

Self-service leave requests, scoped manager approvals, and a three-year audit trail for a
~800-person organisation.

This repository contains the **Day 0 production scaffold** plus the first Day 1 slices: TASK-011
request submission, TASK-012 balance visibility, TASK-013/014 manager queue + decisions, E2-02 real
authentication, and E2-10 notifications. Sign-in uses Supabase Auth; the remaining screens still
render local fixtures. Submission, balances, the manager queue, approve/reject decisions, the
session's employee mapping, and the notification outbox use Postgres. The remaining DB-backed pages
are future Day 1 tasks.

## Stack

| Layer      | Choice                                                         |
| ---------- | -------------------------------------------------------------- |
| App        | Next.js 16 (App Router), React 19, TypeScript                  |
| Styling    | Tailwind CSS v4 (CSS-first `@theme` tokens), self-hosted Inter |
| Data       | Postgres via Supabase, pooled connection (`postgres.js`)       |
| Auth       | Supabase Auth via `@supabase/ssr` (httpOnly cookies)           |
| Logging    | Pino structured JSON                                           |
| Validation | Zod                                                            |
| Tests      | Vitest                                                         |
| Deploy     | Vercel (app) + Supabase (Postgres)                             |

## Quick start

```bash
npm install
npm run env:setup    # creates a gitignored .env.local (local defaults)
npm run db:up        # optional local Postgres 16 on port 55432 (Docker)
npm run db:migrate
npm run db:seed
npm run auth:seed    # creates confirmed Supabase Auth users for seeded employees
npm run dev
```

`npm run env:setup` never overwrites an existing `.env.local`. Sign-in requires a Supabase project:
set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`SEED_AUTH_PASSWORD` in `.env.local`. If you use Supabase instead of the local Docker database,
replace `DATABASE_URL` and `DIRECT_URL` too and skip `db:up`. There is no mock-login fallback: with
an empty Supabase configuration the login page renders a configuration notice.

Open <http://localhost:3000>. You are redirected to `/login`; sign in with one of the seeded
accounts below (the password is `SEED_AUTH_PASSWORD`):

- **Employee** — Maya Chen, own requests and balances
- **Manager** — Daniel Okafor, approvals for five direct reports only
- **HR Admin** — Priya Nair, audit log, org-wide approvals override queue, and effective-dated
  policy administration

```bash
npm run env:setup
# Supabase: replace DATABASE_URL (pooled) and DIRECT_URL (direct), then set the auth values
npm run db:up          # local Docker Postgres only
npm run db:migrate
npm run db:seed
npm run auth:seed      # idempotent; rerun after reseeding employees
```

Submission requires a seeded DB account **and** a matching confirmed Supabase Auth user. The demo
emails are:

- `maya.chen@leavetrack.demo` (Employee, manager Daniel)
- `daniel.okafor@leavetrack.demo` (Manager)
- `priya.nair@leavetrack.demo` (HR Admin, no manager)

## Scripts

| Command                | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Local dev server                              |
| `npm run build`        | Production build (must pass before any PR)    |
| `npm start`            | Serve the production build                    |
| `npm run lint`         | ESLint (Next core-web-vitals + TypeScript)    |
| `npm run typecheck`    | `tsc --noEmit`                                |
| `npm run test`         | Vitest unit tests (DB integration skipped)    |
| `npm run test:watch`   | Vitest watch mode                             |
| `npm run test:db`      | DB integration tests (uses `.env.local`/env)  |
| `npm run format`       | Prettier write (Tailwind class sorting)       |
| `npm run format:check` | Prettier check                                |
| `npm run env:setup`    | Create `.env.local` with local defaults       |
| `npm run db:up`        | Start local Docker Postgres on 55432          |
| `npm run db:down`      | Stop the local Docker Postgres                |
| `npm run db:migrate`   | Apply `db/migrations/*.sql`                   |
| `npm run db:seed`      | Idempotent demo seed                          |
| `npm run auth:seed`    | Create confirmed auth users for seeded emails |

Quality order: `lint → typecheck → test → build`.

Single test: `npx vitest run tests/format.test.ts -t "counts dates inclusively"`.

## Database

Set `DATABASE_URL` to the Supabase **pooled** connection string (port `6543`, transaction mode) and
`DIRECT_URL` to the direct connection (port `5432`) for migrations.

```bash
cp .env.example .env.local
npm run db:migrate
npm run db:seed
```

- The app builds and most pages render with no database configured.
- Sign-in and every authenticated page need a Supabase Auth project plus a migrated DB, because the
  session maps the verified email to a `users` row.
- `/requests/new`, `/balance`, `/notifications`, `/requests`, `/audit`, `GET /api/leave-requests`,
  `POST /api/leave-requests`, `GET /api/notifications`, and `GET /api/audit/:userId` require a
  configured, migrated DB.
- `/api/health` reports `database: "not_configured"` until a URL is present.
- Migrations are tracked in `schema_migrations` and run in a transaction.
- The seed uses fixed UUIDs and `ON CONFLICT DO NOTHING`, so it is safe to run repeatedly.
- `leave_requests` and `audit_log` reject hard deletes at the trigger level. Requests are
  soft-deleted with `is_deleted`; audit rows are append-only.
- **Owner-only commands.** After the `ADR-LeaveTrack-E005` cutover (`DATABASE_URL` → the
  least-privilege `leavetrack_app` role), migrations, the seed, and `npm run test:db` must still use
  the owner: `npm run db:migrate`, `npm run db:seed` (they refuse `leavetrack_app`) and
  `DATABASE_URL="$DIRECT_URL" npm run test:db`. The DB suites write (they update `users`, delete
  ledger rows, and leave append-only audit rows), so never point `npm run test:db` at a real
  project. `npx vitest run tests/db-authorization.integration.test.ts` is read-only and safe.
- The database is deny-by-default for `anon`/`authenticated` (no grants, restrictive RLS deny
  policies). The app role never receives `DELETE` or DDL. See `knowledge/patterns/db-authorization.md`.

## Authentication (E2-02)

Sign-in uses Supabase Auth through `@supabase/ssr`. The mock `mock-role`, `mock-user`, and
`mock-email` cookies are gone.

- `proxy.ts` verifies the provider session with `auth.getClaims()` and copies refreshed cookies onto
  the response. It is an authentication gate only; role checks stay in pages, route handlers, and
  SQL.
- `getSession()` verifies the provider user, requires a confirmed email, then maps that email to
  exactly one `users` row with `findUserByEmail` (case-insensitive). The role and display name come
  from the DB row, never from provider claims or a cookie.
- An authenticated identity with no `users` row is signed out; the login form reports that the
  account is not linked.
- `npm run auth:seed` creates or updates confirmed auth users for every seeded employee using
  `SEED_AUTH_PASSWORD`. It needs the service-role key and refuses to run with
  `NODE_ENV=production` unless `SEED_AUTH_ALLOW_PRODUCTION=1`.
- Required env: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public),
  `SUPABASE_SERVICE_ROLE_KEY` (server/script only), and `SEED_AUTH_PASSWORD` (local development
  only).
- `GET /auth/callback` completes magic-link, OAuth, and email-confirmation redirects, then maps the
  verified email before redirecting to `/dashboard` or `/forbidden`.
- Missing auth configuration fails closed: protected pages redirect to `/login`, protected APIs
  return `503 SERVICE_UNAVAILABLE`, and the login page explains the configuration gap.

## Submitting a request (TASK-011)

`POST /api/leave-requests` accepts JSON:

```json
{
  "leaveTypeId": "11111111-1111-4111-8111-111111111111",
  "startDate": "2026-11-16",
  "endDate": "2026-11-20",
  "reason": "Family trip with a documented handover."
}
```

- `201` — pending request created + `audit_log` submitted row. The response includes the request
  and a `warning` object.
- `400` — malformed JSON, non-UUID leave type, reversed dates, or invalid reason.
- `401` — no valid provider session.
- `403` — the verified email has no matching `users` row.
- `503` — database not configured or unavailable.

The request is created for the **DB user matched by the session email**; a client-supplied
`userId` is rejected by the strict schema. The cookie role is UI-only.

**Over-balance is advisory.** The API compares requested days with the confirmed
`leave_balances` row for that leave type. It returns `warning.exceedsBalance = true` and still
creates the pending request; Unpaid leave never warns and no balance is deducted at submission.

**Manager notification** is a transactional outbox row addressed to the pending request's manager
(see “Notifications” below). The response still reports `managerNotified`, which means “a manager
was assigned”, not “delivery succeeded”.

`/settings/policies` is DB-backed and read/write for HR. `/requests`, `/balance`, `/notifications`,
the dashboard, and the `/approvals` queue are also DB-backed.

## Balance API and page (TASK-012)

`GET /api/leave-requests?scope=mine` returns the authenticated DB user's data:

```json
{
  "balances": [
    {
      "leaveType": { "id": "…", "name": "Vacation", "tracksBalance": true },
      "confirmed": 12.5,
      "pending": 5,
      "accrualPerMonth": 1.25,
      "lastAccruedAt": null
    }
  ],
  "requests": [
    {
      "id": "…",
      "leaveType": { "id": "…", "name": "Vacation", "tracksBalance": true },
      "startDate": "2026-11-16",
      "endDate": "2026-11-20",
      "days": 5,
      "status": "pending",
      "createdAt": "2026-11-01T09:12:00.000Z"
    }
  ]
}
```

- `scope=mine` returns the authenticated user's data. `scope=team` is manager-only and returns the
  manager's direct reports + their active requests; employees/HR receive 403.
- Confirmed balances come from `leave_balances`; pending is the sum of active pending requests per
  leave type. Pending is never folded into confirmed.
- `lastAccruedAt` is the latest `accrual_ledger.created_at` for that leave type, or `null` when no
  accrual has run. Approving a request no longer moves it, and untracked types (Unpaid) are always
  `null`.
- `/balance` uses the same `getMyLeaveData` service server-side; the GET route serves API clients.
- `/requests`, `/requests/[id]`, and the role-aware dashboard are DB-backed. The `/approvals` queue
  is DB-backed for managers and now supports approve/reject; HR gets a separate cross-team override
  queue at `/approvals`.

## Approve/reject decisions (TASK-014)

`POST /api/leave-requests/:id/decision` accepts:

```json
{ "decision": "approved" }
{ "decision": "rejected", "reason": "Team is at capacity that week." }
```

- **Approve** — manager only, direct reports only. The request becomes `approved`, the tracked
  leave balance is decremented by the inclusive day count, `decided_by`/`decided_at` are set, and
  an `approved` audit row is written in the same transaction.
- **Leave types are independent** — approval decrements only the request's own leave type. Vacation
  and Sick have separate balance rows; Unpaid has none, and no type is ever adjusted with another.
- **Reject** — requires a non-empty reason; status becomes `rejected`, balance is unchanged,
  `decision_note` stores the reason, and a `rejected` audit row is written.
- **403** — caller is not a manager or the request owner is not the caller’s direct report.
- **404** — request does not exist or is soft-deleted.
- **409** — already decided, or the employee’s confirmed balance is lower than the requested days.
  Over-balance approval, including through the HR override path, is E2-11; the scaffold never clamps
  a balance silently.
- **Unpaid** — its leave type has `tracks_balance = false` (and no policy or balance rows are
  seeded), so submission skips the balance lookup entirely and approval succeeds with no balance
  change.
- The queue buttons are manager-only; the history table stays read-only. Every action refreshes the
  queue and history.

## HR cross-team override (E2-07)

`POST /api/leave-requests/:id/override` is HR-only and accepts:

```json
{ "override": true, "decision": "approved", "reason": "Payroll reconciled the balance." }
{ "override": true, "decision": "rejected", "reason": "Duplicate of an approved request." }
```

- The explicit `override: true` flag and a 3–2000 character reason are required for both decisions;
  the schema is strict, so a missing flag, blank reason, or extra field is a 400.
- HR can act on any pending request, but never their own (403). Pending/duplicate requests stay 409.
- The override shares `decideLeaveRequest`'s transaction: approve decrements only the tracked balance,
  `decided_by` is the HR actor, `decision_note` stores the reason, and an audit row is written with a
  detail prefixed `HR override`. No schema change is needed; the distinct audit action is E2-11.
- Over-balance approval still returns 409 for everyone in E2-07; E2-11 owns the negative-balance path.
- HR reads the org-wide queue through `listOrgLeaveRequests()`. The manager queue's
  `WHERE employee.manager_id = :current_user_id` predicate is unchanged, and `scope=team` still
  returns 403 for HR.
- `/approvals` shows HR the org-wide pending queue with override buttons; `/requests/[id]` shows an HR
  override panel for pending requests that are not their own.

## HR audit report (TASK-015)

`GET /api/audit/:userId` returns one employee’s full audit report:

```json
{
  "success": true,
  "data": {
    "employee": { "id": "…", "name": "Maya Chen", "email": "…", "role": "employee" },
    "requests": [
      {
        "id": "…",
        "reference": "LR-00000001",
        "status": "rejected",
        "decidedBy": { "id": "…", "name": "Daniel Okafor", "email": "…" },
        "decidedAt": "2026-11-04T01:20:00.000Z"
      }
    ],
    "events": []
  }
}
```

- **HR Admin only.** Employees and managers receive 403; unauthenticated requests receive 401.
- **AC1** — every request made by the employee, with `status`, `decidedBy`, and `decidedAt`.
- **AC2** — requests with `is_deleted = true` are excluded from `requests` and `events`, but the row
  and its audit history still exist in the table (no purge, no hard delete).
- **404** — unknown or malformed `userId`. `requestReference` is derived from the request UUID
  (`LR-` + last eight hex characters) because `leave_requests` has no reference column.
- The `/audit` page renders the same report for a selected employee; its accrual stats come from
  `getAccrualSummary()`.

## Monthly accrual (TASK-017)

`GET`/`POST /api/jobs/accrual` applies one month of accrual for every tracked leave policy:

```json
{
  "success": true,
  "data": { "period": "2026-11-01", "usersAccrued": 10, "balancesAccrued": 20, "totalDays": 22.5 }
}
```

- **System auth, not a session.** The route is public in `proxy.ts` and requires
  `Authorization: Bearer $CRON_SECRET`. A missing secret returns 503; a bad or missing header
  returns 401.
- **Vercel Cron uses GET.** `vercel.json` schedules `0 6 1 * *` (06:00 UTC on the 1st); `POST` is
  kept because the architecture contract names it. Both verbs run the same handler. Vercel's Hobby
  plan only allows daily schedules — that is safe here, because a daily run after the first one is a
  no-op.
- **Idempotent per month.** `accrual_ledger` stores one row per `(user_id, leave_type_id, period)`.
  The ledger insert and the balance upsert happen in one statement, so a repeat run records and
  credits nothing. A user added mid-month still accrues on a later run because their pair has no
  ledger row yet.
- **Periods are UTC month starts** (`YYYY-MM-01`); `lib/domain/accrual.ts` owns the conversion.
- Unpaid and any other `tracks_balance = false` type is skipped, as is a policy with a zero rate.
- **Effective-dated rates.** Each run resolves the latest `leave_policies` row whose
  `effective_from` is on or before the run period, so a mid-year change affects only later months.
  The ledger is never recalculated.
- The dashboard and `/audit` read accrual status from `accrual_ledger` via `getAccrualSummary()`.
  `/settings/policies` is DB-backed and read/write for HR.

## Policy administration (E2-08)

`POST /api/policies` is HR-only and upserts one effective-dated rate:

```json
{
  "userId": "a0000000-0000-4000-8000-000000000004",
  "leaveTypeId": "11111111-1111-4111-8111-111111111111",
  "accrualPerMonth": 1.5,
  "effectiveFrom": "2027-01-01"
}
```

- **HR Admin only.** Employees and managers receive 403; unauthenticated requests receive 401.
- `effectiveFrom` must be the first day of a month. Periods before the current UTC month are
  rejected with 400; the current and future months are accepted. Once that month has already
  accrued for the employee and leave type (an `accrual_ledger` row holds the period), a save for
  it is rejected with 409 — the accrual job's idempotency marker means the new rate could never
  apply. Pick the next month instead.
- **Append-only periods.** A new month inserts a dated row. Correcting the current or a future month
  updates that row. Earlier months stay untouched.
- **One audit row per change.** A real insert or update writes exactly one `policy_audit_log` row
  with the employee, leave type, effective month, previous rate, new rate, actor, and timestamp. A
  same-month save with the same rate is a no-op and writes none.
- `audit_log` remains request-bound (`leave_request_id` is NOT NULL, and its action CHECK is limited
  to submitted/approved/rejected), so policy events use their own append-only table.
- `/settings/policies` gives HR the form, the current-rate snapshot, and the recent change log.
  Both the page and the route use `canConfigurePolicies`; the policy snapshot and balance card read
  the rate effective today, while the accrual job reads the rate effective for its run month.

## Notifications (E2-10)

Submissions and decisions write to a durable outbox in the same transaction as the event, then
deliver in-app immediately and email from a cron worker.

- **Two rows per event.** `notifications` stores one `in_app` row (status `sent`, readable at once)
  and one `email` row (status `pending`) per recipient. The unique key
  `(event_type, leave_request_id, recipient_id, channel)` makes a replayed submit or decision a
  no-op — nothing is rewritten or sent twice.
- **Who is notified.** A submission goes to the owner's manager; with no manager it goes to every
  active `hr_admin`, matching the “HR review” copy on the submit page. Approve/reject (including an
  HR override) notifies the request owner. Inactive recipients are skipped in SQL.
- **The transaction never sends email.** `POST /api/leave-requests` and the decision/override
  routes only write rows. Delivery is `GET`/`POST /api/jobs/notifications`, a system route public
  in `proxy.ts` and protected by `Authorization: Bearer $CRON_SECRET` (like the accrual job).
- **Bounded retries.** The worker leases up to 25 due rows with `for update skip locked`, sends them
  one at a time, and records `sent`, `failed` (exponential backoff, terminal after
  `MAX_EMAIL_ATTEMPTS = 5`), or `skipped` (transport not configured). A bad address fails only its
  own row. `vercel.json` schedules the job every 15 minutes; Hobby only allows daily crons, so use
  Pro or an external scheduler there.
- **Transport.** `EMAIL_TRANSPORT=log` is the default: it reports success and contacts nobody, so
  local and demo environments need no provider. `EMAIL_TRANSPORT=resend` is a dependency-free
  `fetch` adapter behind `EMAIL_API_KEY` + `EMAIL_FROM`; both stay server-side, and a missing value
  records the row as `skipped` instead of retrying forever.
- **In-app inbox.** `/notifications` lists the session user's `in_app` rows newest first, with
  mark-read and mark-all-read; the sidebar and mobile header show an unread badge. Reads are
  recipient-scoped in SQL, so a foreign notification id is a 404.

`GET /api/notifications?limit=50` returns `{ items, unreadCount }`;
`POST /api/notifications/:id/read` and `POST /api/notifications/read-all` update read state.

## Project structure

```
app/
  (auth)/login/          Supabase sign-in page + server action
  auth/callback/         Provider code exchange + identity mapping
  (app)/                 Authenticated shell and role-scoped pages
    dashboard/           Role-aware overview
    requests/            My requests, new request, request detail
    balance/             DB-backed confirmed vs pending balances
    notifications/       In-app notification inbox + mark-read
    approvals/           DB manager queue + decisions; HR override queue
    audit/               HR audit report (DB-backed, per employee)
    settings/policies/   HR effective-dated policy admin
    settings/people/     HR directory, manager assignment, deactivation, import
    forbidden/           403 page
  api/health/            Health probe
  api/leave-requests/    GET/POST + [id]/decision + [id]/override
  api/policies/          POST /api/policies (HR policy rate upsert)
  api/people/            HR profile/manager/status + bulk import
  api/audit/             GET /api/audit/:userId (HR admin only)
  api/notifications/     GET list + [id]/read + read-all
  api/jobs/              accrual + notification outbox cron routes
  globals.css            Tailwind v4 tokens + layered base styles
components/
  ui/                    Design-system primitives
  domain/                Leave-specific composed components
  layout/                App shell, sidebar, top bar, mobile nav
lib/
  api/                   Error envelope + API handler wrapper
  auth/                  Roles, Supabase clients, session + identity mapping
  db/                    Lazy pooled client, DB users, leave-request service
  domain/                Pure leave rules (balance warning)
  notifications/         Email transports, copy templates, outbox worker
  mock/                  legacy Day 0 fixtures (no page imports them)
  validation/            Zod request/decision/override/policy schemas
db/migrations/           Postgres schema
db/seed.sql              Demo data
scripts/                 Migration + seed runners
tests/                   Vitest unit tests
knowledge/               Design system, standards, prompts, patterns
proxy.ts                 Next 16 route guard (not middleware.ts)
```

## Current boundaries

- **Real auth.** Supabase Auth issues the session cookies; `proxy.ts` verifies them before every
  non-public route. The mock `mock-*` cookies and role selector are removed. Server components read
  the session with `getSession()`, which maps the verified email to the DB `users` row.
- **Split data.** `GET`/`POST /api/leave-requests`, the decision and override routes,
  `POST /api/policies`, `/requests/new`, `/balance`, `/notifications`, `/requests`, `/requests/[id]`,
  the dashboard, `/settings/policies`, and the manager + HR `/approvals` queues use Postgres. No
  page reads `lib/mock/data.ts`.
- **Route handlers.** `/api/health`, `GET`/`POST /api/leave-requests`,
  `POST /api/leave-requests/:id/decision`, `POST /api/leave-requests/:id/override`,
  `POST /api/policies`, `/api/people/*`, `GET /api/audit/:userId`, `GET /api/notifications`,
  `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`,
  `GET`/`POST /api/jobs/accrual`, `GET`/`POST /api/jobs/notifications`, and `GET /auth/callback`.
- **Manager queue scope.** `scope=team` is manager-only. It uses
  `WHERE employee.manager_id = :current_user_id`; employees and HR receive 403. HR override uses a
  separate org query and endpoint; it never widens the manager queue.
- **No provider SDK beyond auth.** Email is a plain `fetch` adapter behind `EMAIL_TRANSPORT`; there
  is no email, storage, payments, or OAuth SDK beyond what Supabase Auth provides.

The provider proves identity only. Authorization still uses the DB user row and SQL relationship
scoping, never a provider claim or a cookie role.

## Security notes

- Manager scope is defined as a SQL predicate (`WHERE manager_id = :current_user_id`), never a
  client-side filter. See `knowledge/patterns/manager-scope.md`.
- Session cookies are issued by Supabase Auth through `@supabase/ssr`: httpOnly, `SameSite=Lax`,
  and `Secure` in production. `proxy.ts` refreshes them and sets `no-store` on auth responses.
- A verified provider email maps to exactly one `users` row via the `users_email_lower_unique`
  index. Provider role claims are ignored.
- Security headers (CSP, HSTS in production, frame denial, nosniff, referrer and permissions
  policies) are set in `next.config.ts`.
- No CORS headers are sent: the app is same-origin only by design. Add a scoped allowlist only when
  a real cross-origin client exists.
- API failures use exactly one envelope: `{ "success": false, "error": { "code", "message" } }`.
- `POST /api/leave-requests` resolves the DB user by session email and rejects a client-supplied
  `userId`; neither a cookie role nor a provider claim ever grants API identity.
- Request creation and the submitted audit row run in one transaction. No balance is decremented
  until approval.
- Server logs are Pino JSON with cookies, authorization headers, passwords, and tokens redacted.

## Design

There was no Figma export in this workspace. The provisional design system is documented in
[`knowledge/design-system.md`](knowledge/design-system.md) and implemented in `app/globals.css`.
Replace that document when a Figma export becomes available.

## Contributing

- Conventional Commits (`feat:`, `fix:`, `chore:`, …). Commitlint enforces it.
- Pre-commit runs ESLint and Prettier on staged files through Husky + lint-staged.
- CI runs `lint → typecheck → test → build` and applies migrations + seed twice against Postgres to
  prove idempotency, then runs the DB integration tests for request submission and balance data.
- Read [`AGENTS.md`](AGENTS.md) before your first change.

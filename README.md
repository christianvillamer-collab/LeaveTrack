# LeaveTrack

Self-service leave requests, scoped manager approvals, and a three-year audit trail for a
~800-person organisation.

This repository contains the **Day 0 production scaffold** plus the first Day 1 slices: TASK-011
request submission, TASK-012 balance visibility, and TASK-013/014 manager queue + decisions.
Authentication is still mocked with an httpOnly cookie, and the remaining screens still render local
fixtures. Submission, balances, the manager queue, and approve/reject decisions use Postgres. Real
auth and the remaining DB-backed pages are future Day 1 tasks.

## Stack

| Layer        | Choice                                                         |
| ------------ | -------------------------------------------------------------- |
| App          | Next.js 16 (App Router), React 19, TypeScript                  |
| Styling      | Tailwind CSS v4 (CSS-first `@theme` tokens), self-hosted Inter |
| Data         | Postgres via Supabase, pooled connection (`postgres.js`)       |
| Auth (Day 0) | Mock httpOnly cookie session, 8-hour expiry                    |
| Logging      | Pino structured JSON                                           |
| Validation   | Zod                                                            |
| Tests        | Vitest                                                         |
| Deploy       | Vercel (app) + Supabase (Postgres)                             |

## Quick start

```bash
npm install
npm run env:setup    # creates a gitignored .env.local (local defaults)
npm run db:up        # optional local Postgres 16 on port 55432 (Docker)
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run env:setup` never overwrites an existing `.env.local`. If you use Supabase instead of the
local Docker database, replace `DATABASE_URL` and `DIRECT_URL` in `.env.local` and skip `db:up`.
The mock pages work without a database; the DB-backed pages need these values.

Open <http://localhost:3000>. You are redirected to `/login`; any valid email and any password
work. Pick a demo role:

- **Employee** — Maya Chen, own requests and balances
- **Manager** — Daniel Okafor, approvals for five direct reports only
- **HR Admin** — Priya Nair, audit log and policies; the approvals override is not part of
  TASK-013

No `.env` file is needed to browse the mock pages. For DB-backed pages, either use the generated
local defaults or point the two URLs at Supabase:

```bash
npm run env:setup
# Supabase: replace DATABASE_URL (pooled) and DIRECT_URL (direct)
npm run db:up          # local Docker Postgres only
npm run db:migrate
npm run db:seed
```

Submission requires a seeded DB account. The mock login accepts any email, but only these demo
emails can submit:

- `maya.chen@leavetrack.demo` (Employee, manager Daniel)
- `daniel.okafor@leavetrack.demo` (Manager)
- `priya.nair@leavetrack.demo` (HR Admin, no manager)

## Scripts

| Command                | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Local dev server                             |
| `npm run build`        | Production build (must pass before any PR)   |
| `npm start`            | Serve the production build                   |
| `npm run lint`         | ESLint (Next core-web-vitals + TypeScript)   |
| `npm run typecheck`    | `tsc --noEmit`                               |
| `npm run test`         | Vitest unit tests (DB integration skipped)   |
| `npm run test:watch`   | Vitest watch mode                            |
| `npm run test:db`      | DB integration tests (uses `.env.local`/env) |
| `npm run format`       | Prettier write (Tailwind class sorting)      |
| `npm run format:check` | Prettier check                               |
| `npm run env:setup`    | Create `.env.local` with local defaults      |
| `npm run db:up`        | Start local Docker Postgres on 55432         |
| `npm run db:down`      | Stop the local Docker Postgres               |
| `npm run db:migrate`   | Apply `db/migrations/*.sql`                  |
| `npm run db:seed`      | Idempotent demo seed                         |

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
- `/requests/new`, `/balance`, `/audit`, `GET /api/leave-requests`, `POST /api/leave-requests`, and
  `GET /api/audit/:userId` require a configured, migrated DB.
- `/api/health` reports `database: "not_configured"` until a URL is present.
- Migrations are tracked in `schema_migrations` and run in a transaction.
- The seed uses fixed UUIDs and `ON CONFLICT DO NOTHING`, so it is safe to run repeatedly.
- `leave_requests` and `audit_log` reject hard deletes at the trigger level. Requests are
  soft-deleted with `is_deleted`; audit rows are append-only.

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
- `401` — no session cookie.
- `403` — the session email has no matching `users` row.
- `503` — database not configured or unavailable.

The request is created for the **DB user matched by the session email**; a client-supplied
`userId` is rejected by the strict schema. The cookie role is UI-only.

**Over-balance is advisory.** The API compares requested days with the confirmed
`leave_balances` row for that leave type. It returns `warning.exceedsBalance = true` and still
creates the pending request; Unpaid leave never warns and no balance is deducted at submission.

**Manager notification** is the pending row becoming visible to the manager via
`users.manager_id` (the scoped queue itself is TASK-013). The response reports
`managerNotified`. No email provider or notifications table is part of this task.

Known temporary boundary: after submission, `/requests` and the manager dashboard still render mock
fixtures until the remaining Day 1 tasks. The `/approvals` queue is DB-backed for managers.

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
      "lastAccruedAt": "2026-11-01T00:00:00.000Z"
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
- `lastAccruedAt` reflects `leave_balances.updated_at`, so any balance change (an accrual or an
  approved request) moves it. `accrual_ledger` is the authoritative monthly marker.
- `/balance` uses the same `getMyLeaveData` service server-side; the GET route serves API clients.
- `/requests`, `/requests/[id]`, and the manager dashboard remain mock-backed for now. The
  `/approvals` queue is DB-backed for managers and now supports approve/reject; HR sees an explicit
  override-boundary state.

## Approve/reject decisions (TASK-014)

`POST /api/leave-requests/:id/decision` accepts:

```json
{ "decision": "approved" }
{ "decision": "rejected", "reason": "Team is at capacity that week." }
```

- **Approve** — manager only, direct reports only. The request becomes `approved`, the tracked
  leave balance is decremented by the inclusive day count, `decided_by`/`decided_at` are set, and
  an `approved` audit row is written in the same transaction.
- **Reject** — requires a non-empty reason; status becomes `rejected`, balance is unchanged,
  `decision_note` stores the reason, and a `rejected` audit row is written.
- **403** — caller is not a manager or the request owner is not the caller’s direct report.
- **404** — request does not exist or is soft-deleted.
- **409** — already decided, or the employee’s confirmed balance is lower than the requested days
  (HR override is required; the scaffold does not clamp balances).
- **Unpaid** — approval succeeds with no balance row/change.
- The queue buttons are manager-only; the history table stays read-only. Every action refreshes the
  queue and history.

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
- The `/audit` page renders the same report for a selected employee; the last-accrual stat stays
  mock data.

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
- The dashboard, `/settings/policies`, and `/audit` accrual stats remain mock (`accrualSummary`).

## Project structure

```
app/
  (auth)/login/          Mock login page + server action
  (app)/                 Authenticated shell and role-scoped pages
    dashboard/           Role-aware overview
    requests/            My requests, new request, request detail
    balance/             DB-backed confirmed vs pending balances
    approvals/           DB manager queue + decisions (HR state explicit)
    audit/               HR audit report (DB-backed, per employee)
    settings/policies/   HR policy read-only view
    forbidden/           403 page
  api/health/            Health probe
  api/leave-requests/    GET/POST + [id]/decision
  api/audit/             GET /api/audit/:userId (HR admin only)
  globals.css            Tailwind v4 tokens + layered base styles
components/
  ui/                    Design-system primitives
  domain/                Leave-specific composed components
  layout/                App shell, sidebar, top bar, mobile nav
lib/
  api/                   Error envelope + API handler wrapper
  auth/                  Roles, session cookie read, route access
  db/                    Lazy pooled client, DB users, leave-request service
  domain/                Pure leave rules (balance warning)
  mock/                  Day 0 fixtures still used by the remaining pages
  validation/            Zod request/decision schemas
db/migrations/           Postgres schema
db/seed.sql              Demo data
scripts/                 Migration + seed runners
tests/                   Vitest unit tests
knowledge/               Design system, standards, prompts, patterns
proxy.ts                 Next 16 route guard (not middleware.ts)
```

## Current boundaries

- **Mock auth only.** The login server action sets `mock-role`, `mock-user`, and `mock-email`
  cookies; no provider is called. `proxy.ts` guards every non-public route and API path. Server
  components read the session with `getSession()`.
- **Split data.** `GET`/`POST /api/leave-requests`, the decision route, `/requests/new`, `/balance`,
  `/audit`, and the manager `/approvals` queue use Postgres. The dashboard, request list/detail, and
  policy pages still read `lib/mock/data.ts`.
- **Route handlers.** `/api/health`, `GET`/`POST /api/leave-requests`,
  `POST /api/leave-requests/:id/decision`, `GET /api/audit/:userId`, and
  `GET`/`POST /api/jobs/accrual`.
- **Manager queue scope.** `scope=team` is manager-only. It uses
  `WHERE employee.manager_id = :current_user_id`; employees and HR receive 403. The HR override
  view is not part of TASK-013.
- **No external services.** No email, storage, payments, Supabase Auth, or OAuth.

The mock session must never ship past Day 0. Day 1 replaces how the cookie is issued; the guard,
route scoping, and server-component session read stay the same. API authorization already uses the
DB user row, not the cookie role.

## Security notes

- Manager scope is defined as a SQL predicate (`WHERE manager_id = :current_user_id`), never a
  client-side filter. See `knowledge/patterns/manager-scope.md`.
- Session cookies are httpOnly, `SameSite=Lax`, 8 hours, and `Secure` in production.
- Security headers (CSP, HSTS in production, frame denial, nosniff, referrer and permissions
  policies) are set in `next.config.ts`.
- No CORS headers are sent: the app is same-origin only by design. Add a scoped allowlist only when
  a real cross-origin client exists.
- API failures use exactly one envelope: `{ "success": false, "error": { "code", "message" } }`.
- `POST /api/leave-requests` resolves the DB user by session email and rejects a client-supplied
  `userId`; the cookie role never grants API identity.
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

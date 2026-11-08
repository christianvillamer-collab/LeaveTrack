# LeaveTrack

Self-service leave requests, scoped manager approvals, and a three-year audit trail for a
~800-person organisation.

This repository contains the **Day 0 production scaffold** plus the first Day 1 slices: TASK-011
request submission, TASK-012 balance visibility, and TASK-013/014 manager queue + decisions, and
E2-02 real authentication. Sign-in uses Supabase Auth; the remaining screens still render local
fixtures. Submission, balances, the manager queue, approve/reject decisions, and the session's
employee mapping use Postgres. The remaining DB-backed pages are future Day 1 tasks.

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
- **HR Admin** — Priya Nair, audit log and policies; the approvals override is not part of
  TASK-013

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
- `/requests/new`, `/balance`, `/audit`, `GET /api/leave-requests`, `POST /api/leave-requests`, and
  `GET /api/audit/:userId` require a configured, migrated DB.
- `/api/health` reports `database: "not_configured"` until a URL is present.
- Migrations are tracked in `schema_migrations` and run in a transaction.
- The seed uses fixed UUIDs and `ON CONFLICT DO NOTHING`, so it is safe to run repeatedly.
- `leave_requests` and `audit_log` reject hard deletes at the trigger level. Requests are
  soft-deleted with `is_deleted`; audit rows are append-only.

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
- **Leave types are independent** — approval decrements only the request's own leave type. Vacation
  and Sick have separate balance rows; Unpaid has none, and no type is ever adjusted with another.
- **Reject** — requires a non-empty reason; status becomes `rejected`, balance is unchanged,
  `decision_note` stores the reason, and a `rejected` audit row is written.
- **403** — caller is not a manager or the request owner is not the caller’s direct report.
- **404** — request does not exist or is soft-deleted.
- **409** — already decided, or the employee’s confirmed balance is lower than the requested days
  (HR override is required; the scaffold does not clamp balances).
- **Unpaid** — its leave type has `tracks_balance = false` (and no policy or balance rows are
  seeded), so submission skips the balance lookup entirely and approval succeeds with no balance
  change.
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
  (auth)/login/          Supabase sign-in page + server action
  auth/callback/         Provider code exchange + identity mapping
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
  auth/                  Roles, Supabase clients, session + identity mapping
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

- **Real auth.** Supabase Auth issues the session cookies; `proxy.ts` verifies them before every
  non-public route. The mock `mock-*` cookies and role selector are removed. Server components read
  the session with `getSession()`, which maps the verified email to the DB `users` row.
- **Split data.** `GET`/`POST /api/leave-requests`, the decision route, `/requests/new`, `/balance`,
  `/audit`, and the manager `/approvals` queue use Postgres. The dashboard, request list/detail, and
  policy pages still read `lib/mock/data.ts`.
- **Route handlers.** `/api/health`, `GET`/`POST /api/leave-requests`,
  `POST /api/leave-requests/:id/decision`, `GET /api/audit/:userId`,
  `GET`/`POST /api/jobs/accrual`, and `GET /auth/callback`.
- **Manager queue scope.** `scope=team` is manager-only. It uses
  `WHERE employee.manager_id = :current_user_id`; employees and HR receive 403. The HR override
  view is not part of TASK-013.
- **No provider SDK beyond auth.** No email, storage, payments, or OAuth client beyond what Supabase
  Auth provides.

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

# AGENTS.md — LeaveTrack

## What this repo is

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Postgres/Supabase leave-management app.

**Day 0 scaffold + TASK-011/012/013/014/015/016/017 + E2-02/03/05/06/07/08/09/10.** Sign-in uses
Supabase Auth (`@supabase/ssr`); the mock `mock-*` cookies are gone. The role-aware dashboard reads
balances, requests, audit rows, policies, and accrual status from Postgres; `POST /api/leave-requests`
and `/requests/new` write to Postgres, while `GET /api/leave-requests` + `/balance` + `/requests` +
`/requests/[id]` + the manager `/approvals` queue read from it. Managers can approve/reject through
`POST /api/leave-requests/:id/decision`, HR can override any pending request through
`POST /api/leave-requests/:id/override`, and HR reads per-employee reports through
`GET /api/audit/:userId` + `/audit`. HR sets effective-dated policy rates through
`POST /api/policies` + `/settings/policies`, and manages people through `/settings/people` +
`POST /api/people` + `POST /api/people/*`. A monthly cron job accrues balances through
`GET`/`POST /api/jobs/accrual`. Every application screen is DB-backed; do not reintroduce
`lib/mock/data.ts` into a page.

## Commands

```bash
npm install                 # Node >=22.12; also installs Husky hooks
npm run dev                 # http://localhost:3000 (redirects to /login)
npm run lint && npm run typecheck && npm run test && npm run build   # full gate
npx vitest run tests/format.test.ts -t "counts dates inclusively"    # single test
npm run test:db             # DB integration tests; reads .env.local or DATABASE_URL
npm run env:setup           # create gitignored .env.local with local defaults
npm run db:up               # local Docker Postgres on 55432 (optional)
npm run db:down             # stop the local Docker Postgres
npm run db:migrate          # needs DATABASE_URL/DIRECT_URL in .env.local
npm run db:seed             # idempotent; safe to run twice
npm run auth:seed           # dev-only: confirmed Supabase users for seeded emails
```

- `HUSKY=0` is required for installs in CI or any checkout without `.git`.
- Build works with an empty environment. Sign-in and every authenticated page need Supabase Auth
  env plus a migrated DB; the submission page/API, DB scripts, and health DB probe need a database
  URL. A missing auth configuration fails closed (login notice, 401/503 on APIs).
- Quality order matters: `lint → typecheck → test → build`.

## Architecture that is not obvious from filenames

- **`proxy.ts` is the authentication gate.** Next 16 removed `middleware.ts`; this file exports
  `proxy`. It verifies the Supabase session with `auth.getClaims()` and copies refreshed cookies onto
  the response. It redirects unauthenticated pages to `/login` and returns the JSON error envelope
  for API paths. It does **not** make authorization decisions: role and record checks live in pages,
  route handlers, and SQL.
- `app/(app)/layout.tsx` requires a session **and exports `dynamic = "force-dynamic"`**. Keep it:
  a build with an empty auth environment otherwise prerenders every protected route as a permanent
  `307 → /login`, so runtime secrets would loop `login ↔ dashboard`. `app/(auth)/layout.tsx` must stay
  session-free — the login page itself redirects an existing session to `/dashboard`.
- Session plumbing: `lib/auth/supabase.ts` (server/proxy clients + `isAuthConfigured`),
  `lib/auth/session.ts` (`getSession`, `requireSession`, `requireRole`, `requirePolicy`) and
  `lib/auth/roles.ts` (role taxonomy/labels). `lib/auth/policy.ts` is the single authorization
  matrix; pages and routes pass it an `Actor` (`id` + DB `role`). `getSession()` verifies the
  provider user, requires a confirmed email, then maps it to exactly one `users` row; the DB role,
  id, manager, and name are authoritative.
- Login is a public Route Handler, `POST /auth/login`, not a Server Action. Cookie mutation in a
  page-hosted Server Action makes Next 16 re-render `/login` in the same POST; because that page
  reads the session, it would stream `/dashboard` through the login request and hit the platform
  timeout. The route writes cookies onto its `Response`: hydrated forms receive JSON and hard-navigate
  via the validated `redirectTo`, while no-JS forms receive a 303. Supabase Auth checks the
  credentials, and an authenticated email with no `users` row is signed out. `GET /auth/callback`
  completes magic-link/OAuth/confirmation redirects. Post-login `next` values go through
  `lib/auth/safe-next-path.ts` (rejects `//`, absolute, `\`, control chars, `/login`). Sign-out uses
  `signOut({ scope: "local" })` so cookies clear before the revoke request.
- Public auth paths (`/login`, `/auth/login`, `/auth/demo-login`, `/auth/callback`, `/forbidden`) are
  reachable without a session but are still refreshed in `proxy.ts`; only `/api/health`,
  `/api/jobs/accrual`, and `/api/jobs/notifications` bypass the session read entirely. A Server
  Component cannot persist a rotated refresh token, so skipping that refresh can revoke the session
  via reuse detection.
- One-click demo sign-in is opt-in via `DEMO_LOGIN_ENABLED=true`. `lib/auth/demo-accounts.ts` holds
  only public metadata for the three seeded roles; `/auth/demo-login` validates an allowlisted
  account id, resolves the email, injects the server-only `DEMO_LOGIN_PASSWORD`, and delegates to
  the normal `/auth/login` handler. Never put a password in the client bundle or the demo picker.
- The dashboard is DB-backed per role: employees read `getMyLeaveData`, managers read the
  SQL-scoped `getTeamLeaveData` queue, and HR reads the org-wide list, directory, policy snapshot,
  audit counts, and `getAccrualSummary()`. `/settings/policies` is DB-backed and read/write for HR.
  Types are in `lib/types.ts`; keep component prop shapes stable.
- `lib/db/client.ts` is lazy. Importing it must never open a connection. Supabase's transaction
  pooler requires `prepare: false`; keep the pool at one connection for scripts.
- `lib/db/*` owns SQL. `POST /api/leave-requests` resolves the DB user from the session email and
  writes `leave_requests` + `audit_log` in one transaction. Provider claims and the removed cookie
  role are never an identity source; never trust a client-supplied `userId`.
- Route handlers are `/api/health`, `GET`/`POST /api/leave-requests`,
  `POST /api/leave-requests/:id/decision`, `POST /api/leave-requests/:id/override`,
  `POST /api/policies`, `POST /api/people`, `GET /api/audit/:userId`, `GET /api/notifications`,
  `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`,
  `GET`/`POST /api/jobs/accrual`, `GET`/`POST /api/jobs/notifications`, `POST /auth/login`,
  `POST /auth/demo-login`, and `GET /auth/callback`. All `/api/` failures must go through
  `withApiHandler` + `AppError` and return `{ success:false, error:{ code, message } }`; use
  `successStatus: 201` for created resources. Dynamic routes receive `params` through the handler
  context. The public auth routes (`/auth/login`, `/auth/demo-login`, `/auth/callback`) return JSON
  or redirects and are exempt from that envelope.
- Decisions are manager-only and transactional: lock the request, verify the owner’s `manager_id`,
  reject non-pending/duplicate decisions with 409, decrement only tracked leave types on approve,
  require a reject reason, and insert the append-only audit row in the same transaction. Over-balance
  approval is 409 (E2-11 lets HR override cross the balance); Unpaid approval skips the balance.
- HR override is a separate transactional path (`overrideLeaveRequest`) sharing the decision helper:
  HR role only, `override: true` plus a 3–2000 char reason required for approve and reject, never the
  actor’s own request (403), pending/duplicate 409, and an audit detail prefixed `HR override`.
  Unlike the manager path, HR approval may cross a short balance and stores the true (possibly
  negative) result with a distinct `hr_override_approved` audit action (E2-11).
  `listOrgLeaveRequests()` backs the HR queue; the manager `WHERE manager_id = :current_user_id`
  predicate is unchanged and `scope=team` stays manager-only.
- Leave-request references are stored in `leave_requests.reference` (E2-17), generated by
  `leave_request_reference_seq` with a unique constraint; existing rows kept their former
  UUID-derived `LR-XXXXXXXX` value. `formatRequestReference()` is a pass-through — select the
  stored column in every request/audit query and never derive identity from the request UUID.
  `accrual_ledger` is append-only: a trigger rejects DELETE and UPDATE, and test fixtures use
  run-unique periods with `on conflict do nothing` instead of ledger cleanup.
- Balance reads use `getMyLeaveData`/`getBalancesForUser`: confirmed from `leave_balances`, pending
  from active pending requests. `lastAccruedAt` is the latest `accrual_ledger.created_at` for that
  leave type (`null` when no accrual has run, and always `null` for untracked types) — never
  `leave_balances.updated_at`, which moves on approval.
- Policy rates are **effective-dated** (`leave_policies.effective_from`, a month start; unique with
  `user_id` + `leave_type_id`). The rate in effect for an as-of date is the latest row with
  `effective_from <= as-of`. The accrual job resolves against the **run period**, while
  `getBalancesForUser` and `listPolicyOverview` resolve against the current UTC date; keep those
  three predicates identical or the balance card, dashboard snapshot, and accrual will disagree.
  HR writes through `upsertPolicyRate` (`POST /api/policies`): past months are rejected, a real
  change upserts one dated row and inserts exactly one `policy_audit_log` row, and a same-month
  same-rate save is a no-op. Never rewrite past months or the request-bound `audit_log`.
- People admin is HR-only. `POST /api/people` creates one directory row with an initial role (never
  a role editor for existing rows), takes the `users.manager_graph` advisory lock first, and writes
  exactly one append-only `user_audit_log` row with action `created` in the same transaction. New
  rows have no `auth_subject`; the provider subject binds on first verified sign-in.
- `scope=team` is manager-only (DB role). The direct-report filter is SQL:
  `employee.manager_id = :current_user_id`. Never post-filter in JS. HR override is separate; the
  `/approvals` page shows HR an explicit boundary state.
- `.env.local` is gitignored. `npm run env:setup` writes local Docker defaults; Supabase connections
  replace `DATABASE_URL`/`DIRECT_URL`. Sign-in also needs `NEXT_PUBLIC_SUPABASE_URL` +
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `SUPABASE_SERVICE_ROLE_KEY` and `SEED_AUTH_PASSWORD` are for
  `npm run auth:seed` only and must never reach the browser. The optional demo picker uses separate
  server-only `DEMO_LOGIN_ENABLED` and `DEMO_LOGIN_PASSWORD`; the password must match the seeded
  demo users but is injected only by `/auth/demo-login`.
- Schema lives in `db/migrations/0001_init.sql`; seeds in `db/seed.sql`. Requests and audit rows
  reject hard deletes at the trigger level. Never add a hard-delete path.
- The database is **deny-by-default** for the Supabase client roles (`ADR-LeaveTrack-E005`,
  `db/migrations/0003_db_authorization.sql`): `anon`/`authenticated` have no grants and
  `AS RESTRICTIVE` RLS deny policies (a permissive deny would be OR'd away by a future allow
  policy); `leavetrack_app` is the server-only `NOBYPASSRLS` target with verb-level grants and no
  `DELETE`/`TRUNCATE`. `leave_policies` is `SELECT/INSERT/UPDATE`; `policy_audit_log` is
  `SELECT/INSERT` only. `db/migrations/0005_people_admin.sql` adds `SELECT/INSERT/UPDATE` on
  `users` and `SELECT/INSERT` on the append-only `user_audit_log` (`users` still has no `DELETE`).
  `db/migrations/0006_notifications.sql` grants `SELECT/INSERT/UPDATE` on the append-only
  `notifications` table (no `DELETE`).
  New tables must ship RLS + both policies + grants in the same migration, and
  new functions must revoke `EXECUTE` from `PUBLIC`/`anon`/`authenticated`. The app still connects
  as the owner (`postgres.<project>`), which bypasses RLS, so `lib/auth/policy.ts` and the scoped SQL
  remain the live gate. DB tests and `db:seed` need the owner role; `npm run test:db` writes and must
  never be pointed at a real project. See `knowledge/patterns/db-authorization.md` and
  `knowledge/patterns/people-admin.md`.
- The scheduled jobs (`GET`/`POST /api/jobs/accrual` and `GET`/`POST /api/jobs/notifications`) are
  the only unauthenticated non-health API paths: `proxy.ts` lets them through and each route
  requires `Authorization: Bearer $CRON_SECRET` (constant-time compare, 503 when unset). Vercel
  Cron issues GET, so both verbs share one handler. Accrual idempotency lives in `accrual_ledger`
  (`user_id`, `leave_type_id`, `period`), never in `leave_balances.updated_at`. `/login`,
  `/auth/login`, `/auth/callback`, and `/forbidden` are also public (the auth routes have no session
  yet).
- Notifications are a **transactional outbox** (`ADR-LeaveTrack-E2-10`): `enqueueNotifications(tx, …)`
  writes `in_app` (status `sent`) and `email` (status `pending`) rows in the same transaction as the
  submit/decision and its audit row. The unique key
  `(event_type, leave_request_id, recipient_id, channel)` makes replays no-ops; never send mail
  inside that transaction. A managerless submission notifies every active `hr_admin` (resolved in
  SQL) while `managerNotified` stays `false`. Only `lib/notifications/worker.ts` calls a provider,
  via a leased claim (`next_attempt_at`, `for update skip locked`), exponential backoff, and
  `MAX_EMAIL_ATTEMPTS = 5`. `EMAIL_TRANSPORT=log` is the default; `resend` is a dependency-free
  `fetch` adapter and a missing credential records `skipped`, not a retry. In-app reads are
  recipient-scoped in SQL (a foreign id is 404). See `knowledge/patterns/notifications.md`.
- Manager scope must be a **SQL predicate** (`WHERE manager_id = :current_user_id`), never a
  client-side filter or post-query array filter. See `knowledge/patterns/manager-scope.md`.

## Styling and UI

- Tailwind v4 is CSS-first: there is no `tailwind.config.ts`. Tokens live in `app/globals.css`
  under `@theme`, and must stay **HSL** (no hex/rgb/oklch).
- Any hand-written base selector (`body`, `a`, `input:focus`, …) must sit inside `@layer base`.
  An unlayered rule beats every Tailwind utility app-wide.
- Design source of truth: `knowledge/design-system.md` (there was no Figma export). Inter is
  self-hosted via `next/font/local`; do not reintroduce a Google Fonts fetch.
- Icons are `lucide-react`. Center them with flex or `mx-auto` — never a parent's `text-align`.
- Use the `Field` render-prop so `id`, `aria-describedby`, and `aria-invalid` stay wired.
- `cn()` extends tailwind-merge with the custom font-size names (`text-small`, `text-h1`, …). Without
  that extension, `cn("text-primary-foreground", "text-small")` drops the color. If you add a
  `text-*` size token, register it in `lib/utils/cn.ts` too.
- Dense request/audit tables switch to stacked cards below `xl`; the 1024px sidebar leaves them no
  room to fit. Don't drop them back to `md` without re-running the 1024px overflow check.
- Native `type="date"` inputs need `min-w-0`/`max-w-full` inside grid or flex cells; verify both
  mobile pages at 320 and 375 with the horizontal-scroll check, not just 375.

## Conventions and gotchas

- Conventional Commits; Husky runs lint-staged on pre-commit and commitlint on `commit-msg`.
- `no-console` is an ESLint error. Server logs use `lib/logging/logger.ts` (Pino, redacted).
- Validate at boundaries with Zod (`lib/validation/`). Dates are inclusive; reuse
  `countLeaveDays` and the DB `end_date >= start_date` rule.
- Over-balance is advisory (`lib/domain/leave.ts`): return a warning, still create the pending
  request, never deduct a balance at submission. Unpaid never warns. Manager approval of an
  over-balance request is 409; HR override alone may approve it and store the true (possibly
  negative) balance, with a distinct `hr_override_*` audit action (E2-11).
- Manager notification for submission is the outbox row addressed to the pending request's
  `manager_id` (or every active `hr_admin` when there is no manager); `/approvals` remains the
  manager queue, and `/notifications` is the inbox. Never resolve a recipient from a request body.
- Server components by default. `"use client"` only for state, effects, or event handlers.
- Next 16 APIs are async: `await cookies()`, `await params`, `await searchParams`.
- `tsconfig.json` intentionally uses `"jsx": "react-jsx"` — do not change it to `preserve`.
- Dependencies are pinned exactly (no `^`/`~`). Add a dependency only when the task needs it, then
  regenerate `package-lock.json`.
- `npm install` prints peer-dependency warnings from `eslint-config-next` because its plugins do
  not yet declare ESLint 10. Lint passes; do not downgrade without testing the full gate.
- `lint-staged` is pinned to 16.x because 17 requires Node >=22.22.1 while the project supports
  22.12+.
- No Figma file exists. Do not invent a new palette; extend `knowledge/design-system.md` if the
  design changes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — LeaveTrack

## What this repo is

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Postgres/Supabase leave-management app.

**Day 0 scaffold + TASK-011/012/013/014/015/016.** Auth is still a mock httpOnly cookie. Most screens
read fixtures from `lib/mock/data.ts`; `POST /api/leave-requests` + `/requests/new` write to Postgres,
and `GET /api/leave-requests` + `/balance` + the manager `/approvals` queue read from it. Managers
can now approve/reject through `POST /api/leave-requests/:id/decision`, and HR reads per-employee
reports through `GET /api/audit/:userId` + `/audit`. There is no provider SDK.
Do not wire real auth or the remaining DB-backed pages without a task — that is future Day 1 work.

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
```

- `HUSKY=0` is required for installs in CI or any checkout without `.git`.
- Build works with an empty environment. The submission page/API, DB scripts, and health DB probe
  need a URL; the other mock pages do not.
- Quality order matters: `lint → typecheck → test → build`.

## Architecture that is not obvious from filenames

- **`proxy.ts` is the route guard.** Next 16 removed `middleware.ts`; this file exports `proxy`.
  It redirects unauthenticated pages to `/login` and returns the JSON error envelope for API paths.
  It also imports the mock fixtures for a record-level 307 on `/requests/[id]`; replace that lookup
  with the scoped SQL query on Day 1.
- `app/(app)/layout.tsx` requires a session. `app/(auth)/layout.tsx` must stay session-free — the
  login page itself redirects an existing session to `/dashboard`.
- Session plumbing: `lib/auth/session.ts` (`getSession`, `requireSession`, `requireRole`,
  `canAccessPath`) and `lib/auth/roles.ts` (role permissions). Cookies are `mock-role`,
  `mock-user`, `mock-email`, httpOnly, 8 hours.
- Login is a **Server Action** in `app/(auth)/login/actions.ts`; it is deliberately not an API
  route. Any email/password is accepted.
- Most data still lives in `lib/mock/data.ts` (fixtures + selectors). Types are in `lib/types.ts`.
  Replace selectors task by task; keep component prop shapes stable.
- `lib/db/client.ts` is lazy. Importing it must never open a connection. Supabase's transaction
  pooler requires `prepare: false`; keep the pool at one connection for scripts.
- `lib/db/*` owns SQL. `POST /api/leave-requests` resolves the DB user from the session email and
  writes `leave_requests` + `audit_log` in one transaction. The cookie role is UI-only; never trust
  a client-supplied `userId`.
- Route handlers are `/api/health`, `GET`/`POST /api/leave-requests`,
  `POST /api/leave-requests/:id/decision`, and `GET /api/audit/:userId`. All API failures must go
  through `withApiHandler` + `AppError` and return `{ success:false, error:{ code, message } }`; use
  `successStatus: 201` for created resources. Dynamic routes receive `params` through the handler
  context.
- Decisions are manager-only and transactional: lock the request, verify the owner’s `manager_id`,
  reject non-pending/duplicate decisions with 409, decrement only tracked leave types on approve,
  require a reject reason, and insert the append-only audit row in the same transaction. Over-balance
  approval is 409 (HR override future); Unpaid approval skips the balance.
- Balance reads use `getMyLeaveData`/`getBalancesForUser`: confirmed from `leave_balances`, pending
  from active pending requests. `lastAccruedAt` is `leave_balances.updated_at` until TASK-017 has
  an accrual ledger.
- `scope=team` is manager-only (DB role). The direct-report filter is SQL:
  `employee.manager_id = :current_user_id`. Never post-filter in JS. HR override is separate; the
  `/approvals` page shows HR an explicit boundary state.
- `.env.local` is gitignored. `npm run env:setup` writes local Docker defaults; Supabase connections
  replace `DATABASE_URL`/`DIRECT_URL`.
- Schema lives in `db/migrations/0001_init.sql`; seeds in `db/seed.sql`. Requests and audit rows
  reject hard deletes at the trigger level. Never add a hard-delete path.
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
  request, never deduct a balance at submission. Unpaid never warns.
- Manager notification for submission is the pending row's `manager_id` visibility; there is no
  email provider or notifications table yet (queue is TASK-013).
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

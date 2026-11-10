# Coding standards

Traces to `docs/arch-docs/ARCH-LeaveTrack-v1.0.md`, `ADR-LeaveTrack-E001`, and `AGENTS.md`.

## TypeScript

- `strict` is on and `any` is not allowed without a written reason.
- Prefer `type` for unions/aliases and `interface` for public prop shapes.
- Keep domain types in `lib/types.ts`; components consume them so Day 1 can swap the data source
  without changing props.
- Use the `@/` path alias. Relative imports only within the same feature folder.
- Never cast a cookie or request body with `as` just to silence TS. Validate with Zod.

## Next.js 16

- Server components are the default. Add `"use client"` only for state, effects, or event
  handlers, and keep the client boundary as small as possible.
- `cookies()`, `params`, and `searchParams` are asynchronous — always `await`.
- Route guard is `proxy.ts` exporting `proxy`. Do not create `middleware.ts`.
- `tsconfig.json` must keep `"jsx": "react-jsx"`.
- Mock pages read fixtures; the new-request page queries Postgres in a server component. Client
  components call the mutation API only — no client-side DB and no data fetching in effects.
- Use `next/link` for navigation and `next/navigation` for redirects.

## API and errors

- Every non-2xx response is `{ success: false, error: { code, message } }`.
- Every 2xx response is `{ success: true, data: ... }`.
- Throw `AppError` from `lib/api/errors.ts`; let `withApiHandler` map it. Do not hand-roll JSON
  error responses in a route.
- Keep route handlers thin: authenticate, validate, resolve identity, then call `lib/db/*`. Use
  `successStatus: 201` for creates.
- Never leak stack traces, SQL text, or provider messages to the client. Log the cause with Pino and
  return a stable code/message.
- Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict,
  429 rate limit, 500 unexpected, 503 dependency unavailable.

## Auth and authorization

- Supabase Auth proves identity; the DB `users` row supplies the id, role, manager, and name.
  Provider claims and browser cookies are never an identity or role source.
- Route access is enforced in layers: `proxy.ts` for coarse redirects/authentication,
  `requireSession`/`requirePolicy` in the page/layout, and `lib/auth/policy.ts` for per-record
  checks. `lib/auth/policy.ts` is the single authorization matrix.
- Manager scope must appear in SQL (`WHERE manager_id = :current_user_id`). Client-side filtering
  is a data-exposure bug, not a UX detail.
- HR override views must be explicit and auditable.
- Cookies: httpOnly, `SameSite=Lax`, `Secure` in production, 8-hour expiry.

## Database

- Postgres. Numeric for balances and accrual (`numeric(7,2)` / `numeric(6,2)`), never float.
- Soft delete only: `leave_requests.is_deleted`. Triggers block hard deletes on requests and audit.
- Audit rows are append-only; no update/delete route may exist.
- Migrations are ordered SQL files in `db/migrations/`; never edit an applied migration — add a new
  one.
- Seed SQL must be idempotent (fixed UUIDs + `ON CONFLICT DO NOTHING`).
- Monthly accrual is idempotent through `accrual_ledger` (`user_id`, `leave_type_id`, `period`),
  never through `leave_balances.updated_at`, which any balance mutation changes. See
  `knowledge/patterns/accrual-idempotency.md`.
- Derived display references (for tables with no reference column) must use the **trailing** UUID
  hex segment. Seeded UUIDs share a leading segment (`b0000000-…`), so a first-N slice produces
  duplicate references (`LR-B0000000` for every row).
- Use parameterized queries. No template-string SQL with user input.
- Mutations that affect approval state must write the audit row in the same transaction.
- Balance is not decremented at submission; over-balance is an advisory warning only.
- Manager queries must be indexed; check `EXPLAIN` before adding a scope query.
- If a Supabase client or public anon key is introduced, enable RLS on every table before exposing
  it. Never ship `SUPABASE_SERVICE_ROLE_KEY` to the browser; it bypasses RLS.

## UI

- Follow `knowledge/design-system.md`. Tokens only; no arbitrary hex colors.
- Keep base selectors inside `@layer base`.
- Semantic HTML first, ARIA only to fill gaps. Every interactive element has a visible focus state.
- Show loading, empty, error, and disabled states. Do not ship a happy-path-only component.
- Labels are always associated with controls; errors use `role="alert"` and `aria-describedby`.
- Dense request/audit tables become stacked cards below `xl` (the 1024px sidebar leaves too
  little room); never rely on horizontal page scroll for primary content.
- Native `type="date"` controls have intrinsic widths; give them `min-w-0`/`max-w-full` inside
  grids and flex rows, then verify 320 and 375 with a scroll-width check, not just 375.

## Logging

- Use `lib/logging/logger.ts` on the server. Include a request id when handling a request.
- Never log cookies, authorization headers, passwords, tokens, or full request bodies.
- Client-side errors should log only the error digest, not the message or payload.

## Testing

- Vitest, node environment. Unit-test pure logic (validation, formatting, error envelopes).
- Every new API route needs: success case, validation failure, unauthenticated, forbidden, and the
  scoping case (for manager routes).
- Every migration change needs a CI assertion for the affected table/index/trigger.
- DB integration suites share one Postgres and assert exact balances/counts. Never run two of them
  concurrently — no parallel shells, and no multi-file `vitest run tests/*.integration.test.ts`.
  `npm run test:db` runs each file in its own sequential process for exactly this reason. `npm test`
  also collects these files; with `DATABASE_URL` exported it runs them in parallel, so use
  `test:db` for DB work.
- After switching branches, delete `.next` before `npm run typecheck`; its generated
  `types/validator.ts` still references routes from the previous branch and fails with TS2307.
- Run `npm run lint && npm run typecheck && npm run test && npm run build` before opening a PR, with
  `DATABASE_URL` unset — `npm test` does not read `.env.local`, and an exported URL makes it run the
  integration files in parallel. Run `npm run test:db` separately for DB coverage.

## Git

- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `chore: …`, `docs: …`.
- One logical change per commit. Do not mix formatting-only changes with behavior.
- Never commit `.env*` (except `.env.example`), `node_modules`, `.next`, or credentials.

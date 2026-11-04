# TASK-017 validation — Monthly accrual cron job

## Result

- `npm run build` ✅
- `npm run lint` / `typecheck` / `format:check` ✅
- `npm test` ✅ 34 passed, 18 integration tests skipped (no `DATABASE_URL`)
- `npm run test:db` ✅ 18 passed across request, balance, team, decision, audit, and accrual suites
- End-to-end route check ✅ production `next start`, `Authorization: Bearer $CRON_SECRET`:
  first `GET /api/jobs/accrual` → `{"period":"2026-11-01","usersAccrued":10,"balancesAccrued":20,"totalDays":22.5}`
  with every tracked balance `+1.25` (Vacation) / `+1.00` (Sick) and 20 ledger rows; second call →
  `0/0/0`, balances byte-identical, ledger still 20
- Auth matrix ✅ no `CRON_SECRET` → 503 on GET and POST; missing or wrong bearer → 401;
  `/api/leave-requests` still 401 without a session; `/api/health` 200
- Scoping ✅ Unpaid and other `tracks_balance = false` types produce no balance rows or ledger rows
- DB restored after validation: seeded balances and an empty `accrual_ledger`

## Acceptance criteria

- AC1 — PASS: one run increases each user's Vacation balance by exactly their policy's
  `accrual_per_month` (1.25), Sick by 1.00, and reports `totalDays = 22.5` across 20 pairs.
- AC2 — PASS: a second run in the same month inserts nothing, credits nothing, and leaves balances
  unchanged (`usersAccrued = 0`, `balancesAccrued = 0`, `totalDays = 0`).

## Changes

- `db/migrations/0002_accrual_ledger.sql` — `accrual_ledger` with `unique (user_id, leave_type_id,
period)` and a first-of-month check.
- `lib/domain/accrual.ts` — pure UTC month-start helper (`accrualPeriod`, `isAccrualPeriod`).
- `lib/db/accrual.ts` — one CTE statement: ledger insert (`on conflict do nothing`) feeding a balance
  upsert (`balance = balance + excluded.balance`), so the marker and the credit are atomic.
- `app/api/jobs/accrual/route.ts` — `GET` + `POST`, `CRON_SECRET` bearer auth (timing-safe).
- `proxy.ts` — `/api/jobs/accrual` is public; the route authorizes itself.
- `vercel.json` — monthly cron `0 6 1 * *`.
- Tests, README, AGENTS.md, `scripts/setup-env.mjs`, and `knowledge/patterns/accrual-idempotency.md`.

## Verification method

The route check ran against the local Docker Postgres with a temporary `CRON_SECRET`, using `psql`
for before/after balance snapshots. The suite's integration test does the same at the service layer
with a far-future period, so it never disturbs the seeded month.

## Backlog

- [ ] Dashboard, `/settings/policies`, and `/audit` still show mock `accrualSummary`; wiring them to
      `accrual_ledger`/`leave_balances` needs its own task.
- [ ] No route-level test for the cron auth branch; it is covered by the manual 503/401 matrix. Add a
      handler test if the auth shape grows.
- [ ] `accrual_ledger` has no delete-protection trigger (unlike audit). There is no delete path, but a
      manual purge followed by a rerun would double-accrue. Add an append-only trigger if the ledger
      becomes an audit artifact.
- [ ] The 503 message reveals that `CRON_SECRET` is unset. Acceptable for an operational endpoint;
      revisit if the route is ever exposed beyond the platform scheduler.
- [ ] Vercel Hobby only permits daily crons; the monthly expression needs Pro. Daily runs are safe
      because the ledger makes them no-ops.

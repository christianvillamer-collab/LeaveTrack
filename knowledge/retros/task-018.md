# TASK-018 validation — Independent leave-type balance validation

## Result

- `npm run format:check` / `lint` / `typecheck` ✅
- `npm test` ✅ 31 passed, 17 DB integration tests skipped (no `DATABASE_URL`)
- `npm run test:db` ✅ 5 files / 17 tests, including the two new cases (request 3, decision 6)
- `npm run build` ✅
- Balances restored numerically and test requests soft-deleted after the suite: Maya Sick `8.00`,
  Vacation `12.50`, 3 live seeded requests, 0 Unpaid balance rows. Append-only audit rows from the
  run remain, and the restore updates `leave_balances.updated_at`.

## Acceptance criteria

- AC1 — PASS: approving a 2-day Sick request moves only the Sick row and reports
  `balance.leaveTypeId = Sick`. Vacation is byte-identical before/after, Unpaid still has no balance
  row, and exactly one `approved` audit row is written.
- AC2 — PASS: a 10-day Unpaid submission is created `pending` with
  `warning = { exceedsBalance: false, requestedDays: 10, availableDays: null, message: null }`, no
  balance row appears, the user's balance-row count is unchanged, and a `submitted` audit row exists.

## Changes

- `tests/leave-decision.integration.test.ts` — resolves the Sick type, snapshots and restores both
  Vacation and Sick balances, adds `balanceFor()`, and adds the AC1 test.
- `tests/leave-request.integration.test.ts` — adds the AC2 Unpaid submission test.
- `README.md` — documents per-type isolation and Unpaid's no-policy/no-balance behavior.
- No production code changed. Both ACs already held: `evaluateBalanceWarning` early-returns for
  `tracksBalance = false` (`lib/domain/leave.ts:20-27`), `createLeaveRequest` only reads a balance
  when tracked (`lib/db/leave.ts:446-459`), and `decideLeaveRequest` selects/updates by the request's
  own `leaveType.id` (`lib/db/leave.ts:327-360`).

## Verification method

Service-level integration tests against the local Docker Postgres, run through `npm run test:db`
(one file per process). The decision suite soft-deletes every request it creates and restores both
balances it mutates; the request suite soft-deletes its submissions and never touches balances.

## Non-obvious constraints

- **Never run DB integration suites concurrently.** I accidentally launched two DB test commands in
  parallel; the decision suite decremented Vacation between the request suite's before/after reads,
  producing a false `expected '10.50' to be '12.50'`. `npm run test:db` chains each file in its own
  sequential process for this reason. Recorded in `knowledge/rules/coding-standards.md`.
- **Stale `.next` after a branch switch.** `tsconfig.json` includes `.next/types/**/*.ts`; after
  switching from `feat/task-017-accrual` to this branch, `validator.ts` still referenced the removed
  accrual route and `npm run typecheck` failed with TS2307. Delete `.next` before typechecking.
- **A stray live manual-smoke request breaks exact-count assertions.** `leave-balance` expects Maya
  to have exactly 3 requests and 5 pending Vacation days. A leftover live row (`"jhjhjkjkjjkjijiji"`)
  from an earlier manual check failed the suite; it was soft-deleted (no hard delete) before the
  gate ran.

## Backlog

- [ ] Coverage is service-level only; no HTTP test asserts the decision response reports just the
      request's own leave type. Add one if the route's response shape changes.
- [ ] AC2 asserts balance row-count stability only. Add Vacation/Sick value equality around the
      Unpaid submission so a regression that mutates a sibling value cannot pass.
- [ ] Each integration file calls `getDb().end()` in `afterAll`, which makes ad-hoc multi-file runs
      fragile. Only the per-file `test:db` chain is supported; consider a shared teardown helper.
- [ ] There is no `db:reset` script, so manual smoke rows must be soft-deleted by hand before
      `test:db`. A reset/clean-fixture command would remove that ritual.
- [ ] `leave-balance` assertions depend on exact seed rows and are sensitive to any live artifact.
- [ ] Over-balance approval still returns 409 with no HR override; unchanged by this task.

# TASK-012 validation — Leave balance display page

## Result

- `npm run build` ✅
- `npm run lint` / `typecheck` / `format:check` ✅
- `npm test` ✅ 24 passed, 4 DB tests skipped
- `npm run test:db` ✅ 4 passed across both integration files
- GET matrix ✅ `scope=mine` and omitted scope return 200; `scope=team` returns 400;
  unauthenticated returns 401; unprovisioned email returns 403; no DB returns 503
- DB data ✅ Vacation confirmed `12.5`, pending `5`; Sick `8/0`; Unpaid confirmed `null`;
  three active own requests; pending filter yields the seeded 5-day Vacation request
- Cross-task check ✅ submitting a 2-day request moved pending `5 → 7` and requests
  `3 → 4`; soft-deleting it restored `5 / 3` with confirmed still `12.5`
- UI/Playwright ✅ confirmed/pending cards, pending request row, “Balances as of …”,
  no fabricated next-run date, Unpaid shows “No accrual”, axe clean, 375px no overflow,
  unknown-user state
- No-DB `/balance` ✅ renders the setup alert; GET returns 503
- Graph ✅ new `db/leave.ts` / `leave-requests/route.ts` communities are cohesive;
  `PendingRequestTable` joins the balance UI community; no unexpected client/server crossing

## Acceptance criteria

- AC1 — PASS (with accrual-ledger caveat): every leave type renders the DB confirmed balance
  and an “Updated” timestamp; the page labels the latest as “Balances as of …”. The timestamp is
  `leave_balances.updated_at` because no accrual-run ledger exists yet. TASK-017 owns that ledger.
- AC2 — PASS: pending is shown per leave type in each `BalanceCard` and separately in the
  pending-request table; it is never folded into confirmed.

## Fixed during validation

- Unpaid `BalanceCard` showed a fabricated “Updated” date even though Unpaid has no balance row.
  It now renders “No accrual”; tracked types keep the DB timestamp.

## Follow-up (2026-11-05) — AC1 made true

TASK-017's ledger landed, so `lastAccruedAt` no longer comes from `leave_balances.updated_at`:

- `getBalancesForUser` reads `max(accrual_ledger.created_at)` per leave type and returns `null` when
  no accrual has run. Untracked types (Unpaid) are always `null`.
- The balance page, request form, and `BalanceCard` render “No accrual” instead of a fabricated date.
- Proof: `leave-decision` seeds a ledger row and asserts an approval leaves `lastAccruedAt`
  unchanged; `leave-accrual` asserts a run sets it to the ledger row's `created_at`; `leave-balance`
  seeds three rows and asserts the per-user newest timestamp (so `min` or a dropped `user_id`
  predicate fails the suite) plus Unpaid `null`.

## Backlog

- [x] TASK-017: add an accrual-run ledger and expose the true “last accrual” timestamp instead of
      `leave_balances.updated_at` (which also moves on approval). — done 2026-11-05.
- [ ] TASK-013: add `scope=team` with the SQL `manager_id` predicate; today it is rejected with 400.
- [ ] `/requests`, `/requests/[id]`, and `/approvals` still read mock data.
- [x] `getBalancesForUser` still returns a current `lastAccruedAt` for Unpaid; the UI hides it, but
      API clients see a timestamp. Make the field nullable/policy-derived when the accrual model
      settles. — done 2026-11-05: nullable and policy-derived.
- [ ] A non-configuration DB connection failure on `/balance` falls through to the error boundary;
      add a “database unavailable” state if that becomes noisy.
- [ ] `lastAccruedAt` is now nullable in `GET /api/leave-requests?scope=mine`, but only the DB layer
      is tested; add an HTTP-level test of the balance response shape (null when no ledger row,
      timestamp after a run) so the contract change is locked at the API boundary.
- [ ] `tests/leave-balance.integration.test.ts` still asserts exact seeded numbers (12.5 / 5 / 8).
      Derive confirmed/pending from the request rows instead so a seed tweak does not fail the suite.

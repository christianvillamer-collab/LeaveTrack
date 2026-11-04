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

## Backlog

- [ ] TASK-017: add an accrual-run ledger and expose the true “last accrual” timestamp instead of
      `leave_balances.updated_at` (which also moves on approval).
- [ ] TASK-013: add `scope=team` with the SQL `manager_id` predicate; today it is rejected with 400.
- [ ] `/requests`, `/requests/[id]`, and `/approvals` still read mock data.
- [ ] `getBalancesForUser` still returns a current `lastAccruedAt` for Unpaid; the UI hides it, but
      API clients see a timestamp. Make the field nullable/policy-derived when the accrual model
      settles.
- [ ] A non-configuration DB connection failure on `/balance` falls through to the error boundary;
      add a “database unavailable” state if that becomes noisy.

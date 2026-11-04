# TASK-013 validation — Manager approval queue scoped to direct reports

## Result

- `npm run build` ✅
- `npm run lint` / `typecheck` / `format:check` ✅
- `npm test` ✅ 24 passed, 6 integration tests skipped
- `npm run test:db` ✅ 6 passed across request, balance, and manager-team suites
- Manager queue ✅ Daniel sees exactly Maya, Luis, Amara, Tom, and Sana; Kai/Nina excluded;
  4 pending requests and 5 direct reports
- API ✅ `scope=team` 200 for the DB manager; 403 for HR and employees; `scope=mine` unchanged
- Page access ✅ employee `/approvals` redirects to `/forbidden`; HR sees the explicit
  TASK-013 boundary state
- AC2 ✅ integration test moves Tom to Erin, verifies both queues, and restores `manager_id`
- UI/Playwright ✅ axe clean, 375px no overflow, no cross-team leakage
- Env setup ✅ `env:setup` leaves an existing `.env.local` untouched; `db:up` starts local Postgres;
  `test:db` reads `.env.local` automatically

## Acceptance criteria

- AC1 — PASS: the SQL join filters on `employee.manager_id`; the test asserts exactly five
  employees and no other-team names.
- AC2 — PASS: a temporary `users.manager_id` change moves Tom’s pending request from Daniel’s
  queue to Erin’s; the test restores the original manager.

## Fixed during validation

- Scrollable table regions were not keyboard-focusable (`scrollable-region-focusable` axe rule).
  `components/ui/table.tsx` now gives the overflow wrapper `tabIndex={0}`.
- README still claimed `/approvals` was mock-backed; corrected.
- `npm run test:db` now loads `.env.local` via `--env-file-if-exists`, so the generated env setup
  works without a manual export. CI still supplies `DATABASE_URL` directly.
- A stray active request (`kjkjkjkjkj`) from external/manual testing was found in the local DB and
  soft-deleted; seed counts returned to 11 active requests / 6 active pending.

## Backlog

- [ ] TASK-014: approve/reject actions, balance changes, and decision audit rows. The queue is
      intentionally read-only and `TeamRequestTable` omits the reason column for now.
- [ ] HR override view is a separate task; `scope=team` deliberately returns 403 for HR.
- [ ] Manager dashboard pending preview still reads `lib/mock/data.ts`.
- [ ] `/requests` and `/requests/[id]` remain mock-backed.
- [ ] Team queue has no pagination/status filter; add when volume or TASK-014 needs it.
- [ ] Database connection failures other than “not configured” fall through to the route error
      boundary on `/approvals`, same as the other DB-backed pages.

# TASK-011 validation — Submit leave request form + API

## Result

- `npm run build` ✅
- `npm run lint` / `typecheck` / `format:check` ✅
- `npm test` ✅ 22 passed, 2 DB tests skipped
- `npm run test:db` ✅ 2 passed against Postgres 16
- HTTP matrix ✅ 201 create, 201 over-balance create, 400 reversed date,
  400 invalid UUID, 400 malformed JSON, 400 unknown leave type, 400 extra `userId`,
  401 unauthenticated, 403 unprovisioned email, 503 no DB
- DB invariants ✅ invalid requests created no rows; valid requests created one
  `submitted` audit row and did not change `leave_balances.balance` (12.50)
- UI/Playwright ✅ DB-backed form with UUID options, client and server warning,
  201 success, unprovisioned-user state, 375px layout, axe clean
- Graph blast radius ✅ new server cluster (`new/page.tsx` community) contains
  `createLeaveRequest`, `db/leave.ts`, `getDb`, and the route; `RequestForm` →
  `lib/domain/leave.ts` is a safe pure import. No unexpected client/server leak.

## Acceptance criteria

- AC1 — PASS: pending request + submitted audit row; manager is resolved from
  `users.manager_id` and `managerNotified` is returned. The manager queue UI is the
  approved TASK-013 consumer.
- AC2 — PASS: reversed dates return 400 and create no row; DB check remains the final guard.
- AC3 — PASS: over-balance returns 201 with a warning, creates the request, and does not
  deduct the balance; the form shows the warning before and after submit.

## Backlog

- [ ] TASK-013: make the manager approvals queue read the pending DB rows. Today
      `managerNotified` is a data-layer signal only; the queue page is still mock data.
- [ ] TASK-012/TASK-013: move `/requests` and request detail off mock data. A newly
      submitted DB request is not visible in those pages yet, so the form keeps the
      success confirmation on-page.
- [ ] Friendly validation copy for strict-schema rejections: `.strict()` currently
      surfaces `Unrecognized key: "userId"` instead of a user-facing message.
- [ ] A non-configuration DB connection failure on `/requests/new` falls through to the
      route error boundary; add a "database unavailable" state if that becomes noisy.
- [ ] `npm run test:db` intentionally leaves soft-deleted test requests and their audit
      rows. Use a disposable/migrated DB; the seed-count assertions run before this test.

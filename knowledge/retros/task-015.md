# TASK-015 validation — HR audit report

## Result

- `npm run build` ✅
- `npm run lint` / `typecheck` / `format:check` ✅
- `npm test` ✅ 31 passed, 15 integration tests skipped
- `npm run test:db` ✅ 15 passed across request, balance, team, decision, and audit suites
- API matrix ✅ HR 200, employee 403, no session 401, unknown UUID 404, malformed UUID 404
- Page ✅ `/audit?employee=…` 200 for HR, 307 to `/forbidden` for employees
- Data ✅ every non-deleted request carries `status`, `decidedBy`, and `decidedAt`; history reaches
  back to the earliest seeded request with no date bound
- Graph ✅ `/audit` stays inside the dashboard community and reuses `AuditExplorer`; the new
  `lib/db/audit.ts` boundary is the intended server-side split, not an unexpected crossing

## Acceptance criteria

- AC1 — PASS: `GET /api/audit/:userId` returns every request the employee made with `status`,
  `decidedBy` (`id`, `name`, `email`), and `decidedAt` (nullable while pending).
- AC2 — PASS: soft-deleted requests are excluded from both `requests` and `events`; the integration
  test confirms the `leave_requests` row survives with `is_deleted = true` and its `audit_log` rows
  still exist. No hard-delete path was added.

## Fixed / clarified during validation

- Seed UUIDs share the `b0000000` prefix, so first-eight reference derivation collided on every
  row. `formatRequestReference` now uses the trailing eight hex characters
  (`LR-00000001`, `LR-00000002`, …), covered by a regression test.
- The AC2 test now asserts the audit rows remain after a soft delete, not just the request row.
- README documents the trailing-hex rule and the HR-only/404/AC behaviour.

## Backlog

- [ ] Route-level authz (401/403/404) is verified by smoke test only; add automated route tests
      when the suite gains a route harness.
- [ ] The report has no pagination; an employee with a very long history returns it all.
- [ ] `AuditEventPerson` drops `jobTitle`/`team` because the DB has no such columns; revisit when
      the user profile schema grows.
- [ ] `AuditExplorer` renders an empty table (no empty state) when an employee has no events.
- [ ] The last-accrual stat on `/audit` is still mock data until TASK-017 adds an accrual ledger.
- [ ] Reference truncation is theoretically collidable; replace with a real reference column or
      full UUID display if references become user-facing identifiers.

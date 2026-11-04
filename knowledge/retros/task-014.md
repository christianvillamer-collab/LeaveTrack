# TASK-014 validation — Approve/reject decision endpoint + audit

## Result

- `npm run build` ✅
- `npm run lint` / `typecheck` / `format:check` ✅
- `npm test` ✅ 28 passed, 11 integration tests skipped
- `npm run test:db` ✅ 11 passed across request, balance, team, and decision suites
- HTTP decision matrix ✅ approve 200, reject 200, reject without reason 400,
  duplicate decision 409, non-direct-report 403, employee/HR 403, over-balance 409,
  Unpaid 200 with no balance change, missing/invalid ID 404
- DB invariants ✅ approval `12.5 → 10.5`, rejection unchanged, submitted + decision audit rows,
  `decided_by`/`decided_at` set; test state restored to 11 active requests / balance 12.5
- UI/Playwright ✅ approve/reject dialogs, queue refresh, history update, axe clean, 375px no overflow
- Graph ✅ `decideLeaveRequest`/`TeamDecisionActions`/route form a cohesive server/client split;
  no unexpected boundary crossings

## Acceptance criteria

- AC1 — PASS: direct-report approval sets `approved`, decrements the tracked balance, sets
  `decided_by`/`decided_at`, and writes one `approved` audit row in the transaction.
- AC2 — PASS: rejection requires a reason, sets `rejected`, leaves the balance unchanged, stores
  `decision_note`, and writes one `rejected` audit row.
- AC3 — PASS: a request from another manager’s report returns 403 before any write; the TASK-013
  queue already excludes those requests.

## Fixed / clarified during validation

- Integration assertions were corrected to account for the existing `submitted` audit row in
  addition to the `approved`/`rejected` decision row.
- The pending queue uses a card variant so employee context and approve/reject actions stay visible
  without horizontal scrolling; decision history remains a table.
- Duplicate decisions and over-balance approvals are rejected with 409 without a second decrement.
- Test-created requests were soft-deleted and the Vacation balance restored to 12.5.

## Backlog

- [ ] HR override decisions are still separate; over-balance approval returns 409 for managers.
- [ ] Employee notification on decision is not implemented; only the audit row is written.
- [ ] Manager dashboard and request detail still use mock `ApprovalCard` decision UI.
- [ ] Audit page remains mock-backed; the new decision audit rows are not visible there until
      TASK-015.
- [ ] `TeamDecisionActions` only checks HTTP status, not the success envelope, on a 200 response.
      The API always returns the envelope, so this is defensive hardening.
- [ ] Decision history has no pagination/status filter.

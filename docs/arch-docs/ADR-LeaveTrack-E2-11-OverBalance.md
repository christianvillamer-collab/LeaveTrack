# ADR-LeaveTrack-E2-11: HR over-balance override

## Status

Accepted — E2-11.

## Context

Managers may only approve a leave request when the employee's confirmed balance covers the
inclusive day count; a short balance returns 409. HR cross-team overrides share that decision path,
so E2-07 left HR with the same 409. The backlog required E2-11 to let HR approve an over-balance
request, add a distinct audit action, and never clamp a balance silently. The existing
`audit_log.action` check allowed only `submitted`/`approved`/`rejected`, and
`leave_balances.balance` had `check (balance >= 0)`.

## Decision

1. `db/migrations/0007_hr_over_balance.sql` widens `audit_log.action` to accept
   `hr_override_approved` and `hr_override_rejected`, and replaces the non-negative constraint with
   `check (balance >= -10000)`. The floor prevents a runaway value while allowing the true negative
   remainder of a legitimate HR approval.
2. `applyDecision` takes an `allowOverBalance` flag. It is `false` for the manager path (unchanged 409) and `true` only for `overrideLeaveRequest`. When HR approves a short balance, the transaction
   writes `previous - days` even when negative; nothing is clamped to zero.
3. Override audit rows use the two distinct actions. The append-only detail still starts with
   `HR override` and, for an over-balance approval, contains `Over-balance approval` and the
   `previous → next` transition with the reason.
4. The audit mapper, `AuditEvent` union, audit trail, and HR audit explorer understand the new
   actions, including filter options and badge tones. Unknown action strings still fail closed.

## Consequences

- HR can approve a request that would overdraw tracked leave and the balance card will show the
  negative confirmed value until accrual or policy correction restores it.
- Manager decisions remain the same 409 for over-balance; no new manager capability is introduced.
- Existing audit consumers must handle the two new action values. The union and mapper were widened
  together, so a stale database row with an unknown action still produces a 500 rather than a wrong
  badge.
- The new constraint is asserted in `tests/db-authorization.integration.test.ts` alongside the
  existing append-only trigger checks. Applied migrations are never edited.
- An approval that would cross the `-10000` rail is a handled 409, not a raw postgres 500. The
  balance card clamps its progress width to `0–100%` and renders negative balances in the danger
  state instead of a full, misleading bar.

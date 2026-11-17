-- E2-11 / US-01: HR over-balance override.
--
-- HR may approve a pending request whose tracked balance is short. The true
-- resulting balance (which may be negative) is stored and recorded in the audit
-- detail — nothing is clamped silently. Managers keep the 409 guard in
-- applyDecision(); this migration only widens the storage constraints.
--
-- `audit_log` stays append-only. Distinct override action values mean reports
-- no longer have to parse the `HR override` detail prefix.

alter table audit_log
  drop constraint if exists audit_log_action_check;

alter table audit_log
  add constraint audit_log_action_check
  check (
    action in (
      'submitted',
      'approved',
      'rejected',
      'hr_override_approved',
      'hr_override_rejected'
    )
  );

alter table leave_balances
  drop constraint if exists leave_balances_balance_check;

alter table leave_balances
  add constraint leave_balances_balance_check
  check (balance >= -10000);

-- Allow the HR single-user add flow (E2-23) to record a `created` action.
-- This extends the existing append-only vocabulary; it does not weaken RLS,
-- grants, or the no-delete/no-update triggers shipped in 0005.

alter table user_audit_log
  drop constraint if exists user_audit_log_action_check;

alter table user_audit_log
  add constraint user_audit_log_action_check
  check (
    action in (
      'profile_updated',
      'manager_reassigned',
      'deactivated',
      'reactivated',
      'imported',
      'created'
    )
  );

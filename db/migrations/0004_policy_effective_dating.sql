-- E2-08 / US-05: effective-dated policy rates with an append-only change log.
--
-- A policy rate change must affect only accrual periods from its effective
-- month onward. The rate therefore becomes a dated row instead of a mutable
-- per-employee value: (user, leave type, effective_from) identifies a rate, and
-- the latest row whose effective_from is on or before an as-of date is the rate
-- in effect. Past periods are never recalculated.
--
-- The request-bound audit_log cannot store policy events: leave_request_id is
-- NOT NULL and its action CHECK only permits submitted/approved/rejected. Policy
-- changes get their own append-only table.

-- ---------------------------------------------------------------------------
-- 1. Effective dating on leave_policies
-- ---------------------------------------------------------------------------

alter table leave_policies add column effective_from date;

-- Existing rows predate effective dating, so they apply to every period.
update leave_policies set effective_from = date '2000-01-01' where effective_from is null;

alter table leave_policies alter column effective_from set not null;

alter table leave_policies
  add constraint leave_policies_effective_from_month_start
  check (extract(day from effective_from) = 1);

-- The old key kept one mutable rate per employee/type. Effective-dated rates
-- need one row per period, so replace it rather than widen it.
alter table leave_policies
  drop constraint leave_policies_user_id_leave_type_id_key;

alter table leave_policies
  add constraint leave_policies_user_id_leave_type_id_effective_from_key
  unique (user_id, leave_type_id, effective_from);

-- The server-only app role may now create/correct the current or a future
-- effective month. DELETE stays ungranted; history is append-only.
grant insert, update on table leave_policies to leavetrack_app;
revoke all on table leave_policies from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Append-only policy change log
-- ---------------------------------------------------------------------------

create table policy_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  leave_type_id uuid not null references leave_types (id) on delete restrict,
  effective_from date not null,
  previous_rate numeric(6, 2) check (previous_rate >= 0),
  new_rate numeric(6, 2) not null check (new_rate >= 0),
  actor_id uuid not null references users (id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint policy_audit_log_effective_from_month_start
    check (extract(day from effective_from) = 1)
);

create index policy_audit_log_target_idx
  on policy_audit_log (user_id, leave_type_id, effective_from desc);
create index policy_audit_log_changed_at_idx
  on policy_audit_log (changed_at desc);
create index policy_audit_log_actor_id_idx
  on policy_audit_log (actor_id);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege grants, deny-by-default RLS, and append-only triggers
--    This is a new table, so it ships its own posture in the same migration
--    (ADR-LeaveTrack-E005). No DELETE or UPDATE is ever granted.
-- ---------------------------------------------------------------------------

grant select, insert on table policy_audit_log to leavetrack_app;
revoke all on table policy_audit_log from anon, authenticated;

alter table policy_audit_log enable row level security;

create policy policy_audit_log_app_access
  on policy_audit_log for all to leavetrack_app
  using (true) with check (true);

create policy policy_audit_log_deny_clients
  on policy_audit_log as restrictive for all to anon, authenticated
  using (false) with check (false);

create trigger policy_audit_log_no_hard_delete
  before delete on policy_audit_log
  for each row execute function prevent_hard_delete();

create trigger policy_audit_log_no_update
  before update on policy_audit_log
  for each row execute function prevent_audit_update();

notify pgrst, 'reload schema';

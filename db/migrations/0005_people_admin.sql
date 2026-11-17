-- E2-09 / US-04: HR people administration.
--
-- Three additions:
--   1. Identity/profile columns on `users`: directory fields (job title, team),
--      a provider subject for sign-in mapping, and a deactivation flag.
--   2. `user_audit_log`, an append-only log for people changes. `audit_log` is
--      request-bound and `policy_audit_log` is policy-bound, so neither can
--      store a profile/manager/status change.
--   3. Least-privilege grants and deny-by-default RLS for the new table, plus
--      the `users` INSERT/UPDATE verbs bulk import and profile edits need.
--
-- Deactivation is a flag, never a delete: every reference stays valid and the
-- hard-delete trigger on `users` keeps the no-delete invariant (BR-04).

-- ---------------------------------------------------------------------------
-- 1. People columns on users
-- ---------------------------------------------------------------------------

alter table users
  add column job_title text,
  add column team text,
  add column auth_subject uuid,
  add column is_active boolean not null default true,
  add column deactivated_at timestamptz;

alter table users
  add constraint users_job_title_length
    check (job_title is null or length(trim(job_title)) between 1 and 120),
  add constraint users_team_length
    check (team is null or length(trim(team)) between 1 and 120),
  add constraint users_active_state_coherent
    check (
      (is_active and deactivated_at is null)
      or (not is_active and deactivated_at is not null)
    );

-- One provider identity maps to exactly one employee row. Nullable because
-- rows imported by HR have no sign-in account yet; the partial index still
-- enforces uniqueness for every linked row.
create unique index users_auth_subject_unique
  on users (auth_subject)
  where auth_subject is not null;

-- ---------------------------------------------------------------------------
-- 2. Append-only people audit log
-- ---------------------------------------------------------------------------

create table user_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references users (id) on delete restrict,
  subject_id uuid not null references users (id) on delete restrict,
  action text not null check (
    action in (
      'profile_updated',
      'manager_reassigned',
      'deactivated',
      'reactivated',
      'imported'
    )
  ),
  detail text,
  created_at timestamptz not null default now()
);

create index user_audit_log_subject_idx
  on user_audit_log (subject_id, created_at desc);
create index user_audit_log_created_at_idx
  on user_audit_log (created_at desc);
create index user_audit_log_actor_id_idx
  on user_audit_log (actor_id);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege grants, deny-by-default RLS, and append-only triggers
--    (ADR-LeaveTrack-E005). No DELETE is ever granted; UPDATE is granted on
--    `users` for profile/manager/status changes and never on the audit log.
-- ---------------------------------------------------------------------------

grant select, insert, update on table users to leavetrack_app;
grant select, insert on table user_audit_log to leavetrack_app;

revoke all on table user_audit_log from anon, authenticated;

alter table user_audit_log enable row level security;

create policy user_audit_log_app_access
  on user_audit_log for all to leavetrack_app
  using (true) with check (true);

create policy user_audit_log_deny_clients
  on user_audit_log as restrictive for all to anon, authenticated
  using (false) with check (false);

create trigger user_audit_log_no_hard_delete
  before delete on user_audit_log
  for each row execute function prevent_hard_delete();

create trigger user_audit_log_no_update
  before update on user_audit_log
  for each row execute function prevent_audit_update();

-- BR-04: deactivate, never delete. The app already has no delete path, but the
-- database enforces the invariant for scripts and future code too.
create trigger users_no_hard_delete
  before delete on users
  for each row execute function prevent_hard_delete();

notify pgrst, 'reload schema';

-- LeaveTrack database authorization
-- Traces: E2-04, BR-02, BR-04, US-03, US-04; ADR-LeaveTrack-E005.
--
-- Two layers:
--   1. RLS deny-by-default for the Supabase client roles (`anon`, `authenticated`),
--      with an explicit allow policy for the server-only `leavetrack_app` role.
--   2. An explicit least-privilege grant matrix for `leavetrack_app` (no DELETE,
--      no TRUNCATE, no DDL).
--
-- Caveat: the app currently connects as the Supabase `postgres.<project>` owner,
-- which bypasses RLS. `lib/auth/policy.ts` plus the scoped SQL stay the live
-- authorization gate; this migration closes the anon-key/PostgREST path and
-- defines the role for the documented cutover (ADR-LeaveTrack-E005).
--
-- Rule: a new table must ship its RLS policies and grants in the migration that
-- creates it. Never edit this file after it has been applied.

-- ---------------------------------------------------------------------------
-- 1. Roles
--    Supabase already ships `anon` and `authenticated`; local Docker and CI
--    Postgres do not. Create them only when missing so one migration file
--    produces the same posture everywhere.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon noinherit nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated noinherit nologin;
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'leavetrack_app') then
    create role leavetrack_app noinherit nologin nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;
end
$$;

-- Normalise a pre-existing role (created by hand or an earlier rehearsal).
-- `NOSUPERUSER` is issued only when needed: Supabase's `postgres` is not a
-- superuser and cannot alter the superuser attribute, so a role that is somehow
-- a superuser must be fixed by a real superuser — the migration fails loudly.
do $$
declare
  attrs record;
begin
  select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
  into attrs
  from pg_roles
  where rolname = 'leavetrack_app';

  if attrs.rolsuper then
    execute 'alter role leavetrack_app nosuperuser';
  end if;

  if attrs.rolbypassrls or attrs.rolcreatedb or attrs.rolcreaterole or attrs.rolreplication then
    execute 'alter role leavetrack_app nobypassrls nocreatedb nocreaterole noreplication';
  end if;
end
$$;

grant usage on schema public to leavetrack_app;

-- ---------------------------------------------------------------------------
-- 2. Least-privilege grants for the server-only app role
--    Derived from the actual query surface in lib/db/:
--      users            SELECT                      (identity lookup)
--      leave_types      SELECT                      (type list)
--      leave_policies   SELECT                      (policy reads)
--      leave_balances   SELECT, INSERT, UPDATE      (accrual upsert, approve decrement)
--      leave_requests   SELECT, INSERT, UPDATE      (submit, decide, soft delete)
--      audit_log        SELECT, INSERT              (append-only audit trail)
--      accrual_ledger   SELECT, INSERT              (idempotent accrual ledger)
--    DELETE is never granted; hard deletes stay forbidden by trigger as well.
-- ---------------------------------------------------------------------------

grant select on table users to leavetrack_app;
grant select on table leave_types to leavetrack_app;
grant select on table leave_policies to leavetrack_app;
grant select, insert, update on table leave_balances to leavetrack_app;
grant select, insert, update on table leave_requests to leavetrack_app;
grant select, insert on table audit_log to leavetrack_app;
grant select, insert on table accrual_ledger to leavetrack_app;

-- ---------------------------------------------------------------------------
-- 3. Deny the client roles (anon key / PostgREST path)
--    Supabase's default privileges grant anon/authenticated on tables created
--    by postgres. Revoke those grants now, and revoke the defaults so future
--    tables cannot silently inherit PostgREST access.
-- ---------------------------------------------------------------------------

revoke all on table users from anon, authenticated;
revoke all on table leave_types from anon, authenticated;
revoke all on table leave_policies from anon, authenticated;
revoke all on table leave_balances from anon, authenticated;
revoke all on table leave_requests from anon, authenticated;
revoke all on table audit_log from anon, authenticated;
revoke all on table accrual_ledger from anon, authenticated;

do $$
begin
  -- Created by scripts/migrate.mjs before the migration files run; guard for
  -- manual application so the file never fails on a missing relation.
  if to_regclass('public.schema_migrations') is not null then
    execute 'revoke all on table public.schema_migrations from anon, authenticated';
  end if;
end
$$;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Functions: PostgreSQL grants EXECUTE to PUBLIC by default. Triggers check
-- EXECUTE when the trigger is created, not when it fires (and the owner retains
-- it implicitly), so the client roles do not need it. Revoke the three app
-- functions explicitly rather than "all functions" so Supabase's own
-- `rls_auto_enable` event-trigger function is left alone.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.prevent_hard_delete() from public, anon, authenticated;
revoke execute on function public.prevent_audit_update() from public, anon, authenticated;

alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row-level security
--    Explicit allow for the app role, explicit RESTRICTIVE deny for the client
--    roles. `using (false)` is deliberate: an implicit deny would be impossible
--    to audit. RESTRICTIVE matters: permissive policies are OR'd, so a future
--    re-grant plus a permissive allow policy would silently defeat a permissive
--    deny. As a restrictive policy it is AND'd and always wins.
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'users',
    'leave_types',
    'leave_policies',
    'leave_balances',
    'leave_requests',
    'audit_log',
    'accrual_ledger'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);

    execute format('drop policy if exists %I on public.%I', target || '_app_access', target);
    execute format(
      'create policy %I on public.%I for all to leavetrack_app using (true) with check (true)',
      target || '_app_access',
      target
    );

    execute format('drop policy if exists %I on public.%I', target || '_deny_clients', target);
    execute format(
      'create policy %I on public.%I as restrictive for all to anon, authenticated ' ||
      'using (false) with check (false)',
      target || '_deny_clients',
      target
    );
  end loop;
end
$$;

-- Ask Supabase's PostgREST to discard its cached schema/grants.
notify pgrst, 'reload schema';

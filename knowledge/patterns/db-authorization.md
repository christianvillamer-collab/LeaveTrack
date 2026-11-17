# Database authorization pattern (security-critical)

E2-04 / `ADR-LeaveTrack-E005`: the database is deny-by-default for the Supabase client roles
(`anon`, `authenticated`) and grants a server-only role (`leavetrack_app`) only the verbs the app
actually uses. This is **defense in depth** — `lib/auth/policy.ts` and the scoped SQL remain the
authorization gate. Never describe the DB layer as replacing `WHERE manager_id = :current_user_id`.

## Why two layers

| Path                 | Credential                             | Gate                                                       |
| -------------------- | -------------------------------------- | ---------------------------------------------------------- |
| App (postgres.js)    | `DATABASE_URL` as `postgres.<project>` | App policy + scoped SQL. The owner **bypasses RLS** today. |
| PostgREST (anon key) | `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | No grants → no rows, plus explicit RLS deny policies.      |

RLS alone does nothing on the owner connection; grants alone do nothing for the anon key's separate
role. Both are required.

## New-table checklist

A table is not done until the migration that creates it also does all four:

```sql
-- 1. Enable RLS.
alter table public.my_table enable row level security;

-- 2. Explicit allow for the app role (grants still bound the verbs).
create policy my_table_app_access on public.my_table
  for all to leavetrack_app using (true) with check (true);

-- 3. Explicit deny for the client roles — not an implicit missing policy.
--    RESTRICTIVE matters: permissive policies are OR'd, so a later permissive
--    allow policy for anon/authenticated would silently defeat a permissive deny.
create policy my_table_deny_clients on public.my_table
  as restrictive for all to anon, authenticated using (false) with check (false);

-- 4. Least-privilege grants. Add only the verbs the query surface needs.
grant select, insert on table public.my_table to leavetrack_app;
revoke all on table public.my_table from anon, authenticated;
```

Rules:

- Never grant `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, or DDL to `leavetrack_app`. Hard deletes
  are forbidden by `prevent_hard_delete()`; the missing grant is the second lock.
- Never grant anything on `public` to `anon`/`authenticated`. `ALTER DEFAULT PRIVILEGES` already
  revokes future tables/sequences for the migrating role; keep it that way. It is **per creating
  role**: a table created by `supabase_admin` or dashboard tooling still inherits that role's
  defaults, so RLS + the restrictive deny policy is the backstop.
- Revoke `EXECUTE` on new functions from `PUBLIC`, `anon`, and `authenticated` (PostgreSQL grants it
  to `PUBLIC` by default). Triggers are unaffected — `EXECUTE` is checked when the trigger is
  created, and the owner keeps it implicitly.
- Migrations stay on the owner (`DIRECT_URL`); the app role never holds DDL. `scripts/seed.mjs` and
  `scripts/migrate.mjs` refuse a `leavetrack_app` connection.
- Do not edit `db/migrations/0003_db_authorization.sql` after it is applied. Add a new migration.

## People admin tables (E2-09)

`db/migrations/0005_people_admin.sql` extends the matrix without widening any other table:

| Table            | `leavetrack_app` verbs | Notes                                                         |
| ---------------- | ---------------------- | ------------------------------------------------------------- |
| `users`          | SELECT, INSERT, UPDATE | Profile edits, manager assignment, status, bulk import.       |
| `user_audit_log` | SELECT, INSERT         | Append-only; no UPDATE/DELETE grant, both triggers installed. |

`users` still has no DELETE. Deactivation is an `is_active` flag, and the hard-delete invariant
is unchanged. See `knowledge/patterns/people-admin.md` for the lifecycle and reporting-graph
rules.

## Verification queries

```sql
-- Every public table except schema_migrations must have RLS.
select count(*) from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
  and relname <> 'schema_migrations' and not relrowsecurity;  -- must be 0

-- The expected verbs per table (spot-check the ones you touched).
select has_table_privilege('leavetrack_app', 'public.leave_requests', 'SELECT') as sel,
       has_table_privilege('leavetrack_app', 'public.leave_requests', 'DELETE') as del;

-- The anon key must never reach a row.
select count(*) from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and has_table_privilege('anon', c.oid, 'SELECT');  -- must be 0

-- No column-level grants (a table-level REVOKE ALL clears these, but assert it).
select count(*) from pg_attribute a
join pg_class c on c.oid = a.attrelid
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and a.attnum > 0 and not a.attisdropped and a.attacl is not null;  -- must be 0

-- The app role carries no privileged attribute.
select rolname from pg_roles
where rolname = 'leavetrack_app'
  and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication);  -- must be empty

-- Client roles cannot execute the app functions.
select p.proname, r.rolname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated')) as r(rolname)
where n.nspname = 'public' and p.proname in ('set_updated_at','prevent_hard_delete','prevent_audit_update')
  and has_function_privilege(r.rolname, p.oid, 'EXECUTE');  -- must be empty

-- Explicit policies exist, are the right kind, and are restrictive.
select tablename, policyname, permissive, roles::text from pg_policies order by 1, 2;
```

Behavioural probe (needs superuser or role membership):

```sql
begin; set local role anon; select count(*) from users; rollback;             -- 42501
begin; set local role leavetrack_app; select count(*) from users; rollback;   -- a number
```

## Tests

`tests/db-authorization.integration.test.ts` asserts RLS flags (globally, excluding
`schema_migrations`), the full grant matrix including `TRUNCATE`/`REFERENCES`/`TRIGGER`, explicit and
`RESTRICTIVE` policies, column-level ACLs, role attributes, function `EXECUTE`, default privileges,
and the behavioural denials (skipped when the session cannot `SET ROLE`, e.g. Supabase's `postgres`).
The suite is read-only and safe to run against the project. The CI `database` job repeats the static
checks with psql. **Never run `npm run test:db` against a real project** — several suites write
(balances, requests, append-only audit rows) and it needs the owner role, not `leavetrack_app`.

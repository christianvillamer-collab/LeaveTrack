# ADR-LeaveTrack-E005 — Database Authorization

**Status:** Accepted — enforces deny-by-default for Supabase client roles and defines a server-only least-privilege role; E2-04 implements it.

## Context

`ADR-LeaveTrack-E004` makes `lib/auth/policy.ts` plus scoped SQL the authorization gate: roles gate actions, `users.manager_id` gates records, and every scope is a SQL predicate. That decision governs the **application** path. It says nothing about who may read the database directly.

Today there are two credential paths into the same Postgres instance:

1. **`DATABASE_URL` / `DIRECT_URL` → `postgres.<project>`** — the app's pooled postgres.js client (`lib/db/client.ts`) and the migration/seed scripts. This is the table owner and a Supabase superuser-equivalent: it **bypasses RLS**.
2. **`NEXT_PUBLIC_SUPABASE_ANON_KEY` → PostgREST as `anon` (and `authenticated` for JWTs)** — a public value by construction (it is prefixed `NEXT_PUBLIC_` and ships in the browser bundle). Supabase's default privileges grant these roles broad table access in `public`.

Path 2 is the gap E2-04 names. In the production Supabase project RLS happened to be enabled with **zero policies** — by automatic behaviour (Supabase's `rls_auto_enable` event trigger), so PostgREST returned no rows — but that was undocumented, untested, and not something this repo controlled: `anon`/`authenticated` still held Supabase's default table grants, there was no explicit policy to audit, `schema_migrations` had the same silent coverage, and any newly created table would have started exposed because default privileges grant client access. Local Docker and CI had no RLS at all. `.env.example` even claimed the anon key "is protected by row-level security" — true only by that automatic default, and false in every other environment.

The app must keep working with an empty environment, and the production database credential lives outside the repository, so this ADR has to make the decision **without requiring a credential change to ship**.

## Decision drivers

1. Close the anon-key/PostgREST path now, not "when we get to it".
2. Keep `lib/auth/policy.ts` as the live authorization gate — the DB layer is defense in depth, never a replacement.
3. One migration file must produce the same posture on local Docker, CI `postgres:16`, and Supabase.
4. No credential in the repo; the app must build and run with an empty environment.
5. The decision must be testable in CI, not only in production.
6. No hard-delete path may reappear through a grant.

## Options

### 1. RLS only (keep the owner connection)

- **Pros:** smallest change; closes PostgREST for client roles immediately.
- **Cons:** the app still connects as `postgres.<project>`, which bypasses RLS. Any future mistake that routes user input through that credential is unguarded. The CHANGELOG "least privilege" claim would be untrue.
- **Verdict:** necessary but not sufficient.

### 2. Least-privilege role only (no RLS)

- **Pros:** bounds the app credential; enforces column/verb access at the DB.
- **Cons:** does nothing for the anon key path, because `anon`/`authenticated` are separate roles with their own (default-granted) privileges. RLS is also the only mechanism that can express "this role may not see rows" independently of grants.
- **Verdict:** insufficient for the acceptance criterion "no anon-key path bypasses authorization".

### 3. RLS + least-privilege role, cutover as an ops step

- **Pros:** both credential paths are bounded today; the app role is defined, granted, and tested in the same migration; the only remaining action is swapping `DATABASE_URL`, which is an out-of-band secret change.
- **Cons:** two layers to reason about; the owner connection still bypasses RLS until cutover, so the ADR must say so plainly.
- **Verdict:** **chosen**.

### 4. `FORCE ROW LEVEL SECURITY` on every table

- **Pros:** RLS would apply even to the owner.
- **Cons:** would break the app immediately — the owner has no `leavetrack_app` policy and the connection cannot be changed in this task. It also makes migrations and seeds fail. Rejected; revisit if the app ever stays on the owner connection long-term.

## Decision

Ship **both** layers in `db/migrations/0003_db_authorization.sql`, and document the credential cutover as an ops step.

### Roles

- `anon`, `authenticated` — created only if absent (Supabase has them; local/CI do not), `NOLOGIN NOINHERIT`.
- `leavetrack_app` — `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. The server-only target role; no password is stored in the repo. If the role already exists (a hand-created rehearsal), the migration normalizes those attributes instead of leaving them as found. `NOSUPERUSER` is issued only when the role is actually a superuser, because Supabase's `postgres` is not one and cannot alter the superuser attribute — the migration fails loudly rather than silently leaving a privileged role.

### Grant matrix (`leavetrack_app`)

| Table              | SELECT | INSERT | UPDATE | DELETE | Rationale                                         |
| ------------------ | :----: | :----: | :----: | :----: | ------------------------------------------------- |
| `users`            |   ✅   |   ❌   |   ❌   |   ❌   | Identity lookup only                              |
| `leave_types`      |   ✅   |   ❌   |   ❌   |   ❌   | Seeded reference data                             |
| `leave_policies`   |   ✅   |   ✅   |   ✅   |   ❌   | Effective-dated rate rows; see amendment below    |
| `leave_balances`   |   ✅   |   ✅   |   ✅   |   ❌   | Accrual upsert + approve decrement                |
| `leave_requests`   |   ✅   |   ✅   |   ✅   |   ❌   | Submit, decide, soft delete (`is_deleted`)        |
| `audit_log`        |   ✅   |   ✅   |   ❌   |   ❌   | Append-only; update/delete blocked by trigger too |
| `accrual_ledger`   |   ✅   |   ✅   |   ❌   |   ❌   | Idempotent insert; ledger is append-only          |
| `policy_audit_log` |   ✅   |   ✅   |   ❌   |   ❌   | Append-only policy changes; see amendment below   |

**Amended by E2-08 (`ADR-LeaveTrack-E006`).** This ADR was written when E2-04 shipped, and its
matrix originally withheld `INSERT/UPDATE` on `leave_policies` ("admin writes are future server
work"). E2-08 implemented that work: the app role now holds `INSERT/UPDATE` on `leave_policies`
(no `DELETE`), and `policy_audit_log` was added with `SELECT/INSERT` only. The matrix rows above are
annotated with the current posture; the decision itself (deny-by-default + least-privilege role) is
unchanged, now across eight tables.

No `TRUNCATE`, `REFERENCES`, `TRIGGER`, or DDL is granted. `DELETE` is withheld everywhere; the `prevent_hard_delete` triggers remain the second layer.

`anon` and `authenticated` are revoked on all eight tables plus `schema_migrations`, and `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON TABLES/SEQUENCES FROM anon, authenticated` (executed as the migrating owner) prevents future tables created by that role from inheriting PostgREST access. Tables created by a _different_ role (another migration user, `supabase_admin`, dashboard tooling) are not covered by that default and rely on RLS as the backstop — see "Residual risk" below.

`EXECUTE` on the three application functions (`set_updated_at`, `prevent_hard_delete`, `prevent_audit_update`) is revoked from `PUBLIC`, `anon`, and `authenticated`, and defaults for future functions are revoked for the two client roles. Triggers check `EXECUTE` when the trigger is created, not when it fires, so the client roles lose nothing.

### RLS

- `ENABLE ROW LEVEL SECURITY` on all eight tables.
- `<table>_app_access` — `FOR ALL TO leavetrack_app USING (true) WITH CHECK (true)`. Explicit allow, auditable in `pg_policies`.
- `<table>_deny_clients` — `AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)`. Explicit deny, not an implicit missing policy. It is **restrictive** because PostgreSQL ORs permissive policies: a future re-grant plus a Supabase-style `USING (id = auth.uid())` allow policy would silently defeat a permissive deny, while a restrictive policy is AND'd and always wins.

RLS is the boundary that survives a mis-granted column privilege; the ACLs are the boundary that survives an RLS policy mistake. Neither alone covers both credential paths.

## Anon-key analysis

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is used only by `lib/auth/supabase.ts` (server and proxy clients) to talk to Supabase **Auth**. No browser client exists today, so the key is never sent to the browser by this app — but it is a public value by design, and anyone who obtains it can call PostgREST directly.

Before E2-04, that call was denied only by the production project's automatic policy-less RLS default — there was no test, no explicit policy, and no guarantee a new table would inherit it. After E2-04:

- `anon` and `authenticated` hold no table privileges in `public`, so PostgREST returns `401/403` rather than rows.
- If a privilege is ever re-granted by mistake, the deny policy still blocks every row and every write.
- `service_role` is untouched and still bypasses RLS, as Supabase intends; it is server-only and never referenced by app code.

Auth itself is unaffected: `@supabase/ssr` uses the `auth` schema, which this migration does not touch.

## Cutover runbook (post-merge ops step)

The migration is safe to apply while the app still connects as the owner. Moving the app to `leavetrack_app` is a separate, reversible secret change:

1. **Set a password out of band** (never in the repo):
   `alter role leavetrack_app login password '<generated-secret>';`
2. **Verify the grants and RLS** with the **read-only** authorization suite and two manual probes.
   Run only `npx vitest run tests/db-authorization.integration.test.ts` (or the two probes below)
   against the project database. **Never run `npm run test:db` here:** several of those suites are
   not read-only — `leave-accrual` runs a real accrual and credits seeded balances, `leave-audit`
   and `leave-decision` create requests/decisions whose append-only `audit_log` rows cannot be
   deleted, and an aborted run can leave balances credited.
   `begin; set local role anon; select count(*) from users; rollback;` → `42501`
   `begin; set local role leavetrack_app; select count(*) from users; rollback;` → a number
3. **Confirm the pooler accepts the role.** In the Supabase dashboard, enable the custom role for
   the pooler if required, then build the connection string as
   `postgres://leavetrack_app:<secret>@<pooler-host>:6543/postgres` with `?pgbouncer=true`-equivalent
   settings already handled by `prepare: false`.
4. **Swap `DATABASE_URL`** (and leave `DIRECT_URL` on the owner for migrations, because DDL needs
   ownership). Redeploy; `/api/health` must still report `ok`.
5. **Smoke test** submit → approve → audit → accrual once.
6. **Rollback:** restore the previous `DATABASE_URL`. No schema change is required; the role can be
   left in place with `alter role leavetrack_app nologin;`.

Migrations deliberately stay on `DIRECT_URL`/`DATABASE_URL` as the owner: creating tables, roles, and
policies requires ownership, and the app role must never hold DDL. The same applies to the repo's own
tooling after the cutover:

- `npm run test:db` — **owner only.** The DB suites `update users` and `delete from accrual_ledger`,
  which `leavetrack_app` cannot do by design. Run `DATABASE_URL="$DIRECT_URL" npm run test:db`
  (and keep `DIRECT_URL` on the owner).
- `npm run db:migrate` / `npm run db:seed` — **owner only.** Both scripts now refuse a
  `leavetrack_app` connection and exit with an explanatory error.
- `tests/db-authorization.integration.test.ts` is read-only and safe to point at the project.

## Consequences

- The anon-key/PostgREST path is closed today, independent of the credential cutover.
- The least-privilege role is defined, granted, and tested now; the cutover is one secret change.
- Every new table must ship RLS + a restrictive deny-client policy + explicit grants in the migration that creates it. See `knowledge/patterns/db-authorization.md`.
- The grant matrix is intentionally coarse (no column-level grants, no permission tables). Revisit only if a future feature needs a narrower or wider surface.
- `lib/auth/policy.ts` and the scoped SQL remain the authoritative authorization gate. DB enforcement is defense in depth; it must never be described as replacing `WHERE manager_id = :current_user_id`.
- Tests: `tests/db-authorization.integration.test.ts` asserts RLS flags, the grant matrix (including TRUNCATE/REFERENCES/TRIGGER), explicit policies and their `RESTRICTIVE` flag, column-level ACLs, role attributes, function `EXECUTE`, default privileges, and (where the session may `SET ROLE`) the behavioural 42501 denials. The suite is read-only. The CI `database` job repeats the static assertions with psql, including a global "every public table except `schema_migrations` has RLS" check.

## Residual risk

- **Default privileges are per-creating-role.** `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` covers objects created by the role that ran the migration (`postgres.<project>` on Supabase, `leavetrack` locally). A table created by another role (`supabase_admin`, dashboard tooling) still inherits that role's defaults, which on Supabase grant `anon`/`authenticated`. RLS (and the mandatory restrictive deny policy) is the backstop; a migration that creates tables must run as the owner that holds the revoked defaults.
- **`schema_migrations` has no RLS.** It is a migration bookkeeping table, revoked from the client roles like the rest, but it is excluded from the "all public tables have RLS" assertion. It must never hold application data.
- **The owner connection still bypasses RLS** until the cutover. That is the whole reason `lib/auth/policy.ts` and scoped SQL remain the live gate.

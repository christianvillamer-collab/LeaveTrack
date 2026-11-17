# ADR-LeaveTrack-E2-09 — People Administration

**Status:** Accepted — HR people admin (manager assignment, profile edits, deactivation, bulk import) lands in E2-09.

## Context

HR needs to keep the directory and reporting lines correct without a database console. Two
identity facts make this riskier than a plain CRUD form:

1. **Sign-in is provider-email based today.** `getSession`, the login action, and
   `/auth/callback` map the verified provider email to `users.email`. If HR edits that email,
   the next sign-in cannot find the row and the account is permanently orphaned.
2. **`users` has no lifecycle state.** Removing a person is impossible by design (hard deletes
   are forbidden and every request/audit row references the user), but there is also no way to
   suspend sign-in, record a job title or team, or move a reporting line.

The request-bound `audit_log` cannot record people changes (`leave_request_id` is `NOT NULL`,
and its action vocabulary is submitted/approved/rejected), and `policy_audit_log` is
policy-bound. People changes need their own append-only trail.

## Decision

### 1. Provider subject is the identity key

Add `users.auth_subject uuid` with a partial unique index. Resolution order is:

1. match `auth_subject` to the provider user id;
2. only when no row is linked, fall back to the verified email.

The login action and `/auth/callback` link the subject on the first successful sign-in;
`npm run auth:seed` backfills seeded accounts. Once a row is linked, an email edit cannot
re-point the account, because a linked row never falls back to email. `users.email` becomes the
directory/contact address and may legitimately differ from the provider address.

**Guardrail:** subject-first resolution is what makes directory email edits safe. A linked row keeps
its identity even when HR corrects the address; an unlinked row's address is only the fallback key
until the first verified sign-in binds the subject, so HR can correct an import typo.

### 2. Deactivation is a reversible flag

`is_active` plus `deactivated_at` (coherent check constraint). Deactivation never deletes a row
and never rewrites requests, balances, or audit history. The session layer rejects an inactive
row, so an existing cookie stops working on the next request.

Transactional guards, all inside the same `user_audit_log` transaction:

- an actor cannot deactivate their own account (403);
- the last active `hr_admin` cannot be deactivated (409);
- a manager with active direct reports cannot be deactivated (409).

Reactivation is refused (409) while the person's manager is inactive: their pending requests would
otherwise sit in a queue no one can open. The monthly accrual job also joins `users.is_active`, so a
deactivated person keeps their rate history but stops accruing.

Role changes remain an out-of-scope database operation; there is no role editor.

### 3. Manager reassignment is a reporting-graph edit

The candidate must exist, be active, and hold the `manager` role. A recursive CTE walks the
candidate's upward chain and rejects an assignment that would close a cycle; a
transaction-scoped advisory lock (`users.manager_graph`) serializes concurrent edits so two
requests cannot each pass the check. Same-manager saves are no-ops with no audit row.

Pending requests move automatically because both the manager queue and the approvals page join
on `users.manager_id`. No request row is rewritten, and `scope=team` stays a SQL predicate.

### 4. Bulk import is JSON and transactional

A JSON array (max 200 rows) avoids a CSV dependency and keeps validation in Zod. The batch is
all-or-nothing, keyed on `lower(email)`:

- identical existing rows are skipped with no audit row;
- differing rows update directory fields/reporting line and write one `imported` audit row;
- omitted optional fields (`managerEmail`, `jobTitle`, `team`) are left untouched, while `null` or
  an empty string clears them — an omitted key must never be treated as "clear";
- a manager may already exist or be created earlier in the same batch; forward references fail;
- new rows are inserted with `role = 'employee'` by default and no `auth_subject`.

The batch's existing rows are fetched in a single query rather than one per row, and the lookup map
is updated after each insert so the batch can resolve its own new managers.

Role changes on existing rows are ignored. Provider account creation/invites stay out of scope.

### 5. One append-only audit table

`user_audit_log (actor_id, subject_id, action, detail, created_at)` with
`prevent_hard_delete()` and `prevent_audit_update()` triggers. A real change writes exactly one
row; a no-op writes none. `action` is constrained to
`profile_updated | manager_reassigned | deactivated | reactivated | imported`. The `users` table
also gets `prevent_hard_delete()` so BR-04 holds at the database boundary.

### 6. Authorization stays centralized

`canManagePeople` is the HR-only gate in `lib/auth/policy.ts`. Route handlers check it after
`getSession`; the record-level guards live in the transactional SQL. No page or route
post-filters or trusts a client-supplied actor id.

## Consequences

- Two emails can intentionally diverge (provider vs directory). The people UI says so, and the
  ADR records that the provider email is not used for display.
- Unlinked rows (bulk imports) cannot sign in until `auth:seed` or a first sign-in links them.
- The reporting-graph lock is process-independent (Postgres), so it also protects scripts. Every
  writer of the graph (`reassignManager`, `bulkImportPeople`, `setPersonActive`) takes it first, in
  the same order, so deactivation cannot race an import that is moving a report.
- Deactivated people are excluded from the HR roster/headcount and the manager team view, but stay
  in `listEmployees()` so their audit history remains reachable. The policy rate picker opts into
  `includeInactive` so a leaver's historical rate can still be corrected.
- The migration ships `users` INSERT/UPDATE grants and the new table's grants, RLS allow policy,
  restrictive client deny policy, append-only triggers, and the `users_no_hard_delete` trigger in
  the same file (ADR-E005).
- Deactivation is not just an application convention: the database now rejects a hard delete of a
  `users` row, matching BR-04 for scripts as well as routes.

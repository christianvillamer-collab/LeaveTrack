# People admin pattern (security-critical)

E2-09 / `ADR-LeaveTrack-E2-09-People-Admin`. HR manages the directory, reporting lines, and
account lifecycle. This pattern is the checklist for any future edit to that surface.

## Identity rules

- `users.auth_subject` is the sign-in key. `resolveUserForIdentity` tries the subject first and
  only falls back to `lower(email)` for a row whose `auth_subject is null`.
- Never map a linked row by email. A linked row that falls back to email lets an HR email edit
  hand the account to a different provider identity.
- Link the subject in the login action and `/auth/callback` on first sign-in;
  `scripts/seed-auth.mjs` backfills seeded accounts.
- `users.email` is the directory address. It may differ from the provider email, and the UI must
  say so.
- HR can correct the directory email on linked and unlinked rows. A linked row keeps its identity
  because resolution is subject-first; on an unlinked row the address is only the fallback key
  until the first verified sign-in binds the subject, so a typo must stay fixable.

## Lifecycle rules

- Deactivation is `is_active = false` + `deactivated_at = now()`. Never delete a user row.
- Run all three guards in the same transaction as the update and audit insert:
  1. actor cannot deactivate themselves (403);
  2. the last active `hr_admin` cannot be deactivated (409);
  3. a manager with active direct reports cannot be deactivated (409).
- `getSession` returns `null` for an inactive row, so an existing cookie stops working on the
  next request.
- The monthly accrual job joins `users.is_active = true`; an offboarded person keeps their rate
  history but stops accruing. Do not remove that join.
- Reactivation is refused (409) while the person's manager is inactive: their requests would land
  in a queue nobody can open. Reassign them first.
- Role changes are out of scope on purpose. Do not add a role editor to the people form without a
  new decision and its own guard set.

## Reporting graph

```sql
-- Serialize edits, then lock the subject.
select pg_advisory_xact_lock(hashtext('users.manager_graph'));

with recursive chain as (
  select id, manager_id from users where id = :manager_id
  union
  select u.id, u.manager_id from users u join chain c on u.id = c.manager_id
)
select id from chain where id = :subject_id;
```

- Use `union`, not `union all`: a pre-existing cycle must not loop forever.
- Take the advisory lock **first**, before any row lock, in every writer of the graph
  (reassignment, import, and `setPersonActive`). A row lock first would invert the order against a
  concurrent import and risk a deadlock; `setPersonActive` counts active reports, so it needs the
  same serialization.
- Candidate checks: exists, `is_active`, `role = 'manager'`. HR admins are not manager candidates.
- Requests move with the reporting line because queues join on `users.manager_id`; never rewrite
  `leave_requests`.
- Same-manager saves are no-ops and write no audit row.

## Directory reads

- `listDirectory()` filters `is_active = true` by default, which is what the HR dashboard
  composition table and headcount need; `listDirectReports()` does the same for the manager team
  view. Pass `{ includeInactive: true }` only for surfaces that must still reach a leaver — the
  policy rate picker corrects historical rates.
- `listEmployees()` intentionally keeps deactivated people: `/audit` must still open a leaver's
  history. Do not add an `is_active` filter there.

## Bulk import

- JSON array, 1–200 rows, Zod-validated at the route. All-or-nothing transaction.
- Key on `lower(email)`. Identical rows → skipped, no audit. Changed rows → update + one
  `imported` row. New rows → insert with `role = 'employee'` and no `auth_subject`.
- Optional fields (`managerEmail`, `jobTitle`, `team`) are three-state: an omitted key leaves the
  stored value alone, `null` (or an empty string) clears it, and a value replaces it. Never
  collapse "omitted" into `null` — a partial row would then wipe a reporting line and pull pending
  requests out of the manager queue.
- `managerEmail` must already resolve to an active manager, or name a manager created **earlier in
  the same batch** (`role: "manager"`); forward references are rejected. The whole batch's existing
  rows are fetched in one query, and the map is updated after each insert so first-rollout imports
  need one pass.
- Role changes on existing rows are ignored; provider invites are out of scope.

## Audit

`user_audit_log` is append-only (`prevent_hard_delete` + `prevent_audit_update`). Exactly one row
per real change, action constrained to
`profile_updated | manager_reassigned | deactivated | reactivated | imported`. `detail` carries
the readable before → after (or the deactivation reason).

## Authorization

- `canManagePeople` in `lib/auth/policy.ts` is the only role gate. Routes call `getSession` then
  the gate, and resolve the actor from the session — never from the body.
- Record-level rules stay in the transactional SQL. No JS post-filtering.
- `users` needs SELECT/INSERT/UPDATE for this surface; `user_audit_log` needs SELECT/INSERT only.
  No DELETE, and `users_no_hard_delete` enforces BR-04 at the database for every role.

## Tests that must exist

1. Profile change writes one audit row; a no-op writes none.
2. Directory email corrections persist on unlinked and linked rows; a linked row still resolves by
   subject, not by the new email.
3. Cycle assignment is 409; inactive or non-manager candidates are rejected.
4. Self-deactivation is 403, last active HR is 409, manager with active reports is 409.
5. Reactivation works and is a no-op when already active; reactivation under an inactive manager is 409.
6. Bulk import is idempotent, rolls the whole batch back on one bad row, leaves omitted optional
   fields untouched, and can name a manager created earlier in the same batch.
7. Subject-first resolution beats a changed email; a **linked** row refuses the email fallback;
   inactive rows are rejected by `getSession`.
8. Reassignment moves a pending request from the old manager's queue to the new one without
   rewriting the request row.
9. A case-only directory email correction on a linked row is persisted (not treated as a no-op).
10. The accrual job credits nobody with `is_active = false` and leaves their balance unchanged.

## Test isolation

People tests create users and audit rows that cannot be deleted (`user_audit_log` and the request
FKs block it), so `test:db` must stay rerunnable on one database:

- Never attach an imported/person-admin fixture to a seeded manager. `leave-team` asserts Daniel
  has exactly five direct reports, so a batch row pointing at `daniel.okafor@leavetrack.demo`
  fails the next run. Create a batch-local manager and import under that.
- Requests created by the queue test must belong to temporary people, not seed employees.
- A fresh disposable database still proves `0005` applies cleanly; rerun the whole `test:db` chain
  on the same database to prove the suite did not pollute shared counts.

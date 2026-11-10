# ADR-LeaveTrack-E004 — Authorization Model

**Status:** Accepted

## Context

The app has three roles (`employee`, `manager`, `hr_admin`) and a hard requirement that a manager sees and acts on only their direct reports (BR-02, US-03 AC3, US-04). The current implementation mixes three things:

- role checks in `lib/auth/roles.ts` and `lib/auth/session.ts`;
- mock-based presentation guards in `lib/auth/access.ts` (`currentEmployee()` maps a role to one demo person);
- DB identity and relationship data in `lib/db/users.ts` and the scoped SQL in `lib/db/leave.ts`.

Pure RBAC is insufficient: a `manager` role alone would let every manager see every team. The authorization model must combine role permissions with the `users.manager_id` relationship.

## Decision

Use **RBAC + relationship-based scoping**:

1. **Roles gate actions.** `employee`, `manager`, `hr_admin` decide which operations are available.
2. **Relationships gate records.** An employee sees their own records; a manager sees their direct reports (`employee.manager_id = :current_user_id`) plus their own; HR sees all only through an explicit override path.
3. **Deny by default.** No matching role/permission means no access.
4. **Scope is a SQL predicate.** Never fetch broadly and filter in JavaScript.
5. **DB role is the source of truth.** The session cookie role is a UI hint only; API identity comes from the DB user row.
6. **HR override is separate and audited.** It is an explicit action with a required reason, not a blanket role bypass.
7. **One policy module.** Page and route checks call the same authorization helpers; `lib/auth/access.ts` is replaced, not extended.

### Permission matrix

| Action                  | Employee  | Manager                   | HR Admin                        |
| ----------------------- | --------- | ------------------------- | ------------------------------- |
| Submit/view own request | Yes — own | Yes — own                 | Yes — own                       |
| View team requests      | No        | Yes — direct reports only | Yes — all (override)            |
| Decide pending request  | No        | Yes — direct reports only | Yes — override, reason required |
| Run audit report        | No        | No                        | Yes                             |
| Configure policies      | No        | No                        | Yes                             |
| Run accrual job         | No        | No                        | No — system bearer only         |

## Consequences

- E2-03 replaces the mock `lib/auth/access.ts` and centralizes the policy checks.
- E2-05 moves the record-level guard to the scoped SQL query; the `proxy.ts` fixture lookup is removed.
- E2-15 adds route-level tests for the full matrix.
- E2-04 decides whether the DB also enforces access (RLS) or relies on a server-only least-privilege role.
- For v1, keep the role set coarse and fixed. Do not build a generic permission table or admin UI; revisit only if a fourth role or per-department scoping is required.

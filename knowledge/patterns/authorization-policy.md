# Authorization policy pattern (security-critical)

ADR-E004: authorization is **RBAC + relationship scoping**. Roles gate the kind of action;
`users.manager_id` gates which records a manager may act on. `lib/auth/policy.ts` is the only
authorization matrix — pages, layouts, and route handlers all call it.

## Identity

`getSession()` (E2-02) verifies the provider user, requires a confirmed email, and maps it to
exactly one `users` row. The returned `Session` carries the DB `id`, `role`, `managerId`, `name`,
and `email`. Provider claims, the removed mock cookie, and any client-supplied `userId` are never
authorization inputs.

## API

```ts
import { canViewTeam, canRunAudit } from "@/lib/auth/policy";

const session = await getSession();
if (!session) throw AppError.unauthenticated();

const actor = { id: session.id, role: session.role };

if (!canViewTeam(actor)) throw AppError.forbidden("Manager access is required for scope=team.");
return getTeamLeaveData(session.id);
```

For records, pass the record's owning scope:

```ts
canViewRequest(actor, { ownerId, ownerManagerId, status });
canDecideRequest(actor, { ownerId, ownerManagerId, status });
```

## Matrix

| Check                   | Employee   | Manager                 | HR Admin                  |
| ----------------------- | ---------- | ----------------------- | ------------------------- |
| `canViewRequest`        | own record | own + direct reports    | all records               |
| `canDecideRequest`      | never      | direct reports, pending | no (override is separate) |
| `canViewTeam`           | no         | yes                     | no                        |
| `canDecideTeamRequests` | no         | yes                     | no                        |
| `canManageRequests`     | no         | yes                     | yes                       |
| `canRunAudit`           | no         | no                      | yes                       |
| `canConfigurePolicies`  | no         | no                      | yes                       |

- `canDecideRequest` rejects any non-pending request, even for a direct report, and denies HR.
  An audited HR override is a separate task.
- `scope=team` stays manager-only; the SQL predicate enforces it, the policy gate does not replace it.
- Deny by default: an unknown role or a missing relationship never grants access.

## Page gates

```ts
const session = await requirePolicy(canManageRequests); // redirects to /forbidden on false
```

## Required tests

`tests/auth-policy.test.ts` covers the whole matrix: own / direct report / another manager's report /
unmanaged record, pending vs decided, and every action gate. `tests/auth-session.test.ts` proves the
DB role wins over a forged provider claim or `mock-role` cookie. Integration tests still prove the
SQL manager scope (`WHERE employee.manager_id = :current_user_id`).

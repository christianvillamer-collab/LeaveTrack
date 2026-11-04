# Manager scope pattern (security-critical)

BR-02 / US-03 AC3 / US-04: a manager must never see or act on another team's requests. This is a
data-exposure requirement, not a UI preference.

TASK-013 implements the read queue (`getTeamLeaveData`); TASK-014 implements decision writes
(`decideLeaveRequest`). HR override is intentionally not a manager-scope substitute: the team API
returns 403 for HR, and the approvals page shows an explicit boundary state.

## Rule

The scope predicate belongs in the query:

```sql
select r.*
from leave_requests r
join users u on u.id = r.user_id
where u.manager_id = $1
  and r.is_deleted = false
order by r.created_at desc;
```

Never do this:

```ts
// WRONG: fetches the whole organisation, then filters in JS
const all = await db`select * from leave_requests where is_deleted = false`;
return all.filter((r) => r.manager_id === currentUserId);
```

## Decision endpoint (TASK-014)

```ts
// 1. SELECT ... FOR UPDATE the active request joined to its owner's manager_id.
// 2. manager_id !== currentUserId -> 403 before any status/balance/audit write.
// 3. Non-pending -> 409; reject reason required; approve decrements only tracked leave types.
// 4. Insufficient confirmed balance on approve -> 409 (HR override is a future path).
// 5. Update request + balance + audit insert in the same transaction; never reveal the body on 403.
```

## Tests that must exist

1. Manager with 5 reports sees exactly those 5 employees' requests.
2. Request belonging to another manager's report is absent from `GET ?scope=team`.
3. `POST /:id/decision` on a non-report returns 403 and writes no balance/audit row.
4. Moving `users.manager_id` moves the pending request to the new manager's queue.
5. HR override is a separate view/task; it must not widen `scope=team`.

## Indexes

`leave_requests (user_id, status, created_at desc) where is_deleted = false` plus
`users (manager_id)` keeps the scoped queue under the 500ms p95 target.

# Manager scope pattern (security-critical)

BR-02 / US-03 AC3 / US-04: a manager must never see or act on another team's requests. This is a
data-exposure requirement, not a UI preference.

TASK-013 implements the read queue (`getTeamLeaveData`); TASK-014 implements decision writes
(`decideLeaveRequest`); E2-07 adds the HR override path (`listOrgLeaveRequests` +
`overrideLeaveRequest`). HR override is intentionally not a manager-scope substitute: the team API
still returns 403 for HR, and `/approvals` uses a separate org-wide query for HR.

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

## HR override (E2-07)

`overrideLeaveRequest` shares the same transactional helper as `decideLeaveRequest`, so the lock →
pending check → balance guard → status update → audit insert sequence cannot drift. It differs only
in the relationship gate: HR may act on another user's pending request and may never act on their
own (403). The manager predicate is untouched; the HR queue comes from a separate
`listOrgLeaveRequests()` query with no manager filter.

## Tests that must exist

1. Manager with 5 reports sees exactly those 5 employees' requests.
2. Request belonging to another manager's report is absent from `GET ?scope=team`.
3. `POST /:id/decision` on a non-report returns 403 and writes no balance/audit row.
4. Moving `users.manager_id` moves the pending request to the new manager's queue.
5. HR override is a separate view/task; it must not widen `scope=team`.
6. HR override on another team's pending request succeeds; HR on their own returns 403; managers
   cannot use `/override`; `scope=team` still 403 for HR.

## Pagination and status filters (E2-13)

`listTeamLeaveRequestsPage(managerId, { status, page, pageSize })` adds the shared filter and
`limit/offset` to the **same** SQL predicate. Counts come from `count(*) over ()` on a non-empty
page; an empty page falls back to a scalar `count(*)` built from the identical postgres.js fragment,
because a window count has no row to report when OFFSET is past the end. Ordering is
`created_at desc, id desc` so a page boundary cannot duplicate or skip a row.
`GET /api/leave-requests?scope=team` is still manager-only; HR uses `listOrgLeaveRequestsPage`, not
a widened team scope. `/approvals` never post-filters an org-wide array in the browser.

Invalid `status`, `page`, or `pageSize` values fail closed in `lib/validation/list.ts`: the page
shows an error and loads no rows instead of silently falling back to an unbounded query.

## Indexes and casts

`leave_requests (user_id, status, created_at desc) where is_deleted = false` plus
`users (manager_id)` keeps the scoped queue under the 500ms p95 target. The audit page also uses
`audit_log (leave_request_id, occurred_at desc)`. Cast the **parameter**
(`r.status = $1::request_status`), not the column (`r.status::text = $1`), or the enum indexes
cannot be used. `docs/performance/e2-13-baseline.md` records the EXPLAIN plans and the p95 results
on an 800-user / 20,000-request disposable dataset.

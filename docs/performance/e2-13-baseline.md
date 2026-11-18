# E2-13 list endpoint baseline

Generated: 2026-11-18 (UTC)

## Scope

Server-side pagination and status filters were measured for the four list reads behind
`/api/leave-requests` and `GET /api/audit/:userId`:

- `myRequests` — `listMyLeaveRequestsPage`
- `teamRequests` — `listTeamLeaveRequestsPage` (manager SQL scope)
- `scopedRequests` — `listOrgLeaveRequestsPage` (HR org-wide queue)
- `auditEvents` — `listAuditEventsForEmployee` report page

This is a **database-only** baseline. HTTP, auth, React rendering, and browser work are excluded;
the 800-HTTP-user load test is E2-14.

## Safety and dataset

`scripts/bench-list-endpoints.mjs` refuses to start unless **both** `DATABASE_URL` and `DIRECT_URL`
are exactly:

```
postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e207_verify
```

It does not read `.env.local`. All synthetic rows are inserted inside one transaction and rolled
back at the end, so repeated runs do not accumulate data. The harness also asserts that the target
manager sees exactly 2,500 active requests (800 pending) and no other manager's rows.

| Property                  | Value                                            |
| ------------------------- | ------------------------------------------------ |
| Database                  | `leavetrack_e207_verify` (local Docker Postgres) |
| Managers                  | 8                                                |
| Employees                 | 800                                              |
| Requests per employee     | 25                                               |
| Total synthetic requests  | 20,000                                           |
| Status filter             | `pending`                                        |
| Page size                 | 25                                               |
| Warmup / measured samples | 5 / 120 per query                                |
| Concurrency               | 1 (single connection, no HTTP layer)             |

## Timings (milliseconds)

| Query          |   p50 |   p95 |   p99 |   max |
| -------------- | ----: | ----: | ----: | ----: |
| myRequests     | 0.797 | 0.960 | 1.039 | 1.058 |
| teamRequests   | 3.735 | 4.152 | 4.346 | 4.541 |
| scopedRequests | 6.826 | 7.261 | 7.723 | 8.157 |
| auditEvents    | 0.982 | 1.159 | 1.861 | 3.038 |

**Result:** every p95 is below the 500ms target by more than two orders of magnitude.

## EXPLAIN evidence

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` was run on the same statements at the end of each sample
batch. Index names are extracted from the plan tree.

| Query          | Planning | Execution | Indexes observed                                                          |
| -------------- | -------: | --------: | ------------------------------------------------------------------------- |
| myRequests     | 0.072 ms |  0.053 ms | `leave_requests_manager_scope_idx`, `leave_types_pkey`                    |
| teamRequests   | 0.148 ms |  3.872 ms | `users_manager_id_idx`, `leave_types_pkey`                                |
| scopedRequests | 0.132 ms |  8.298 ms | `leave_requests_status_created_idx`, `leave_types_pkey`, `users_pkey`     |
| auditEvents    | 0.176 ms |  0.065 ms | `audit_log_request_idx`, `leave_requests_manager_scope_idx`, `users_pkey` |

The team plan uses `users_manager_id_idx` to resolve the manager's employees and a hash join over
the request set; that is a cost-based choice at 20,000 rows, not missing index coverage. The
manager-scoped composite index is exercised by the my-requests and audit plans, and the org status
plan uses `leave_requests_status_created_idx`. All three indexes named in E2-13 already exist in
`db/migrations/0001_init.sql`, so **no new migration was added**.

EXPLAIN initially showed the enum casts on the column side (`r.status::text = $1`), which made the
`request_status` indexes unusable. The filters now cast the parameter instead
(`r.status = $1::request_status`), and the plans above reflect that fix.

## Reproduce

```bash
export DATABASE_URL='postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e207_verify'
export DIRECT_URL='postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e207_verify'
npm run bench:lists
```

The command prints one JSON object with the dataset, timings, and plan summaries. A non-zero exit
means the safety guard, manager-scope assertion, or a query failed; no rows are committed.

# ADR-LeaveTrack-E2-13: Server-side list pagination, status filters, and index verification

## Status

Accepted — E2-13.

## Context

Before E2-13, `/requests`, `/approvals`, and `/audit` read full result sets and rendered them in the
browser. The list endpoints had no status filter or page contract, so a growing leave history would
increase query time, payload size, and DOM work together. E2-12 had already made audit pagination a
presentation slice over a full client-side set; with server-side paging, an export must instead ask
the server for the whole filtered set on demand.

E2-13 requires status filtering and pagination to run in Postgres, a measurable sub-500ms p95, and
EXPLAIN evidence for the indexes named in the task. The manager queue is security-sensitive: moving
pagination or filtering into JavaScript must never become a way to widen direct-report scope.

## Decision

1. `lib/validation/list.ts` is the shared contract for `status`, `page`, and `pageSize` across pages
   and APIs. Defaults are page 1 / 25 rows; page size is capped at 100. Empty values mean "no
   filter"; unknown statuses, repeated params, non-integers, zero/negative pages, and oversized
   pages fail closed. `toPaginationMeta()` derives `total` and `pageCount` from `count(*) over ()`
   on non-empty pages. Because a window count cannot report a total when OFFSET returns zero rows,
   an empty page runs one scalar `count(*)` with the identical WHERE fragment (shared via a
   postgres.js fragment) instead.
2. `GET /api/leave-requests` returns `Paginated<T>` inside the standard envelope and accepts
   `scope=mine|team`, `status`, `page`, and `pageSize`. `scope=team` remains manager-only and calls
   `listTeamLeaveRequestsPage`, whose predicate stays `e.manager_id = :current_user_id`. HR uses the
   separate org-wide page query; it cannot widen `scope=team`.
3. `/requests`, `/approvals`, and `/audit` pass their search params through the same Zod schemas.
   Invalid query strings produce an explicit alert with no results (never a silent fallback to an
   unbounded query). Status forms and Previous/Next links preserve valid filters in the URL.
   Stable ordering is `created_at desc, id desc` for requests and `occurred_at desc, id desc` for
   audit events.
4. `GET /api/audit/:userId` accepts `status`, `page`, `pageSize`, and `exportAll=1` in addition to
   the E2-12 employee/date bounds. Normal reads return a 25-event page plus pagination metadata.
   `exportAll=1` returns **all** events matching employee/date/status in the same success envelope;
   `AuditExplorer` applies its local action/search filters to that full set before building the CSV.
   No new API route is introduced.
5. Status predicates cast the parameter (`r.status = $1::request_status`) rather than the column.
   Casting `r.status::text` prevented Postgres from using the `request_status` indexes. The three
   indexes requested by E2-13 — `users(manager_id)`, `leave_requests(user_id,status,created_at)`,
   and `audit_log(leave_request_id,occurred_at)` — already exist in migration 0001 and are used by
   the plans in `docs/performance/e2-13-baseline.md`; no new DDL was added.

## Consequences

- List responses and pages expose a bounded page by default. A client cannot request more than 100
  rows per page, and invalid list input never becomes an unbounded read.
- Request and audit pages can be shared by URL because filters and page numbers live in the query
  string. Same-timestamp ties are broken by id so rows cannot duplicate or disappear between pages.
- Status badges and approval summary cards are explicitly page-scoped. They are derived from the
  current 25 rows; org/team-wide status totals would need dedicated SQL aggregates and are not
  implied by the `total` badge.
- The audit CSV still contains every row matching the current filters, including rows on other
  pages. It is generated on demand from `exportAll=1` instead of shipping the entire history on
  every page render.
- Manager scope is still a SQL predicate. Pagination and status filters are added to that query;
  there is no post-query JavaScript filter and no client-supplied manager id.
- The baseline measures database latency on a disposable 800-user/20,000-request dataset with a
  rolled-back transaction. It establishes E2-13's query budget; E2-14 covers 800 concurrent HTTP
  users, p95/p99 at the application boundary, and scheduled runs.
- Existing array-returning DB helpers remain for dashboard and other callers, so this change does not
  require a broad call-site migration.

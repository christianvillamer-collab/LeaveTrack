# ADR-LeaveTrack-E2-12: Audit date range, pagination, and CSV export

## Status

Accepted — E2-12.

## Context

US-05 requires an HR audit report that can be narrowed to a date window, paged through without
losing rows, and exported as a CSV that matches what is on screen. Before E2-12 the report loaded
an employee's entire history with no date filter, rendered every event in one long list, and had no
export. Two constraints shape the design: soft-deleted requests must stay excluded (BR-04) while no
upper retention cap may be introduced, and `withApiHandler` is a shared surface that should not
change for one report.

## Decision

1. `lib/validation/audit.ts` holds one Zod schema for `employee`, `from`, and `to`, shared by the
   page's search params and the API's query string. Empty strings mean "no filter", dates must be
   ISO `YYYY-MM-DD`, and `to` may not precede `from`. The API `.parse()`s it (an invalid range
   becomes the standard 400 envelope); the page `.safeParse()`s it and falls back to defaults.
2. `getAuditReport(userId, dateRange)` and `listAuditEventsForEmployee(userId, limit, dateRange)`
   apply the range in SQL with inclusive UTC calendar bounds: `>= from::date at time zone 'UTC'`
   and `< (to::date + 1) at time zone 'UTC'` against `leave_requests.created_at` and
   `audit_log.occurred_at`. The `is_deleted = false` predicate is unchanged and no upper date cap
   is added, so 3+ year history stays reportable. Event ordering is `occurred_at desc, id desc` so
   pagination cannot shuffle same-timestamp rows.
3. The existing client-side search and action filters remain the single filter pipeline. Pagination
   is a 25-row display slice over that filtered array, not a second filter. The CSV is generated
   in the browser from the **full filtered set** (same order and columns as the table) through a
   Blob download — no new API route and no change to `withApiHandler`.
4. `actionLabel` moves to `lib/utils/audit.ts` so the badge and the CSV cannot drift, and
   `lib/utils/csv.ts` quotes delimiters/newlines, doubles inner quotes, prefixes formula-like cells
   with `'`, and prepends a UTF-8 BOM for Excel.

## Consequences

- The CSV contains every row matching the current employee, date range, search, and action filter,
  including rows on other pages; pagination is presentation-only.
- Date bounds are UTC calendar days, so an event at 23:59 UTC on `to` is included and one at 00:00
  UTC the next day is not.
- Changing the employee or date range remounts the explorer via a React key, resetting search,
  action filter, and page to avoid a stale out-of-range page.
- Existing callers of `getAuditReport` and `listAuditEventsForEmployee` are unaffected because the
  date range is optional; no migration, new table, or permission change is needed.
- Soft-deleted requests remain hidden from reports even when a date range would otherwise include
  them, and old history is never truncated by a retention upper bound.

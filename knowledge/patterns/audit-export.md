# Audit date ranges and report exports

Two non-obvious constraints shape a report that can be filtered by date and exported.

## Optional date bounds belong in SQL, with nullable parameters

`postgres.js` fragments can be composed, but a report with optional bounds does not need them.
Pass the raw dates as nullable parameters and let a null short-circuit the comparison:

```sql
and ($from::date is null or a.occurred_at >= ($from::date at time zone 'UTC'))
and ($to::date is null or a.occurred_at < (($to::date + 1) at time zone 'UTC'))
```

- `date at time zone 'UTC'` is midnight UTC of that calendar day; `to + 1` makes the end bound
  exclusive, which includes every instant on the `to` day without a millisecond-rounding hack.
- The `is null` branch keeps the same statement for filtered and unfiltered reads — no dynamic SQL,
  no interpolated column names, and no chance of a client value becoming SQL text.
- Apply the _same_ predicate to every timestamp the report reads, and keep the soft-delete filter
  (`is_deleted = false`) independent of it so a date range cannot resurrect a soft-deleted row.
- Never add a retention upper bound to "keep it fast": BR-04 history is 3+ years and must stay
  reportable. Add `id desc` after the timestamp so equal timestamps cannot shuffle between pages.

## Server pages; exports fetch the whole filtered set

E2-12 paginated in the browser. E2-13 moved `status`, `page`, and `pageSize` into the shared list
contract and into Postgres: `listAuditEventsForEmployee(userId, options)` returns one page plus
metadata. A non-empty page gets `count(*) over ()`; an out-of-range page falls back to a scalar
`count(*)` using the same date/status predicate fragment. The date/status soft-delete predicates and
ordering
(`occurred_at desc, id desc`) are unchanged.

A CSV built from the visible page silently drops matches. `AuditExplorer` therefore calls
`GET /api/audit/:userId?…&exportAll=1`, which returns every event matching employee/date/status in
the standard envelope. It then applies the local action/search filters to that full set before
building the CSV, so those interactive filters still match what the user sees. Keep the column
mapping shared:

```
table columns   == AUDIT_CSV_HEADERS  == auditEventToCsvRow(event)
```

Extract the display label (`actionLabel`) instead of duplicating it: the badge used CSS
`capitalize` while a naive CSV wrote the raw lowercase action, so the two disagreed. One
display-ready label makes the export literally match the screen. Prefix formula-like cells with
`'` and prepend a UTF-8 BOM so detail text is inert and readable in Excel. `exportAll=1` is
on-demand; a normal report page never ships the full history.

## Fail closed on invalid filters

A page that parses search params must not substitute `{}` on a parse failure. A reversed range
(`from > to`) then becomes "no bounds" and quietly renders the employee's entire multi-year
history — the opposite of the compliance window the HR user asked for. The same applies to an
unknown `status`, a zero/negative/repeated `page`, or an oversized `pageSize`: none may become an
unbounded report. Resolve params once into either a query or an error; when invalid, return **no
query**, keep the raw strings for the form, show an explicit validation alert, and skip the
report/summary/export entirely. The API can keep using `.parse()` because it has no correction UI;
the page needs the resolver because it does.

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

## Pagination is a display slice; the export uses the whole filtered set

The search/action filters stay the single filter pipeline. Pagination is `filtered.slice(...)`, not
a second filter. A CSV built from `pageRows` silently drops matches, so build it from `filtered`
itself and share the column mapping with the table:

```
table columns   == AUDIT_CSV_HEADERS  == auditEventToCsvRow(event)
```

Extract the display label (`actionLabel`) instead of duplicating it: the badge used CSS
`capitalize` while a naive CSV wrote the raw lowercase action, so the two disagreed. One
display-ready label makes the export literally match the screen. Prefix formula-like cells with
`'` and preprend a UTF-8 BOM so detail text is inert and readable in Excel.

## Fail closed on invalid filters

A page that parses search params must not substitute `{}` on a parse failure. A reversed range
(`from > to`) then becomes "no bounds" and quietly renders the employee's entire multi-year
history — the opposite of the compliance window the HR user asked for. Resolve params once into
either a query or an error; when invalid, return **no query**, keep the raw strings for the form,
show an explicit validation alert, and skip the report/summary/export entirely. The API can keep
using `.parse()` because it has no correction UI; the page needs the resolver because it does.

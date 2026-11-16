# Effective-dated policy rates

A policy rate is not a value — it is a value **plus the period it starts**. A mid-year
change must affect the months from its effective month onward and must never rewrite a
past accrual. The two shapes that look simpler both leak:

- **One mutable row per employee/type** (`update leave_policies set accrual_per_month = …`)
  destroys the rate that past periods were accrued at, so no later read can reconstruct
  history and a late accrual run would silently use today's rate.
- **A rate plus an `updated_at` "version"** still has only one row, so a second change in
  the same month loses the first, and a correction cannot be told apart from a new period.

Store one row per `(user, leave type, effective month)` and resolve by date.

```sql
create table leave_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  leave_type_id uuid not null references leave_types (id) on delete restrict,
  accrual_per_month numeric(6, 2) not null check (accrual_per_month >= 0),
  effective_from date not null,
  constraint leave_policies_effective_from_month_start
    check (extract(day from effective_from) = 1),
  unique (user_id, leave_type_id, effective_from)
);
```

The "rate in effect for an as-of date" is always the **latest row at or before that date**:

```sql
select distinct on (user_id, leave_type_id)
  user_id, leave_type_id, accrual_per_month
from leave_policies
where effective_from <= $1::date
order by user_id, leave_type_id, effective_from desc
```

## The predicate is the whole feature

Three readers resolve the same way, and they must use the **same** predicate with a
**different as-of date**:

| Reader               | As-of date         | Why                                    |
| -------------------- | ------------------ | -------------------------------------- |
| `runAccrual(period)` | the **run period** | A late run must use that month's rate. |
| `getBalancesForUser` | current UTC date   | The balance card shows today's rate.   |
| `listPolicyOverview` | current UTC date   | The HR snapshot shows today's rate.    |

Resolving the accrual job against "today" instead of its run period is the classic bug: a
backfill for January after a March rate change credits the March rate. Resolving the read
sides against the newest row (including future-dated changes) is the other one: the
dashboard announces a raise that has not started.

Use `distinct on (…) … order by …, effective_from desc` or a `left join lateral` with
`order by effective_from desc limit 1` — never `max(effective_from)` alone, which returns
the date but not the row's rate.

## Writing a rate

- **Future months are writable; the current month only until it accrues; past months are always
  rejected.** Compare against the current UTC month in the app (`effective_from < currentUtcMonth()`
  → 400). Inside the transaction, also reject a month whose `(user_id, leave_type_id, period)` row
  already exists in `accrual_ledger` (→ 409): the idempotent run will never re-credit it, so the
  change would be recorded but unused. The DB keeps a month-start CHECK but does not know "today's
  month"; do not hide the rule in a trigger.
- **"Update" means correcting the current or a future month.** Upsert on
  `(user_id, leave_type_id, effective_from)`; a new month inserts, a correction replaces
  that month's rate. Earlier months are untouched by construction.
- **A same-month, same-rate save is a no-op.** Return early before the upsert and write no
  audit row, or a double-click produces two identical history entries.
- **New-month `previous_rate` comes from the row before it**, not from `null` and not from
  the row being inserted. Read the earlier effective row in the same transaction.
- Wrap the rate write and the audit insert in **one transaction**, so a failure cannot leave
  a changed rate with no history row (or a history row with no change).

```ts
if (sameMonth?.accrual_per_month === String(rate)) return { auditWritten: false, … };

const [saved] = await tx`
  insert into leave_policies (user_id, leave_type_id, accrual_per_month, effective_from)
  values (…)
  on conflict (user_id, leave_type_id, effective_from)
  do update set accrual_per_month = excluded.accrual_per_month
  returning accrual_per_month, effective_from::text as effective_from
`;

await tx`insert into policy_audit_log (… previous_rate, new_rate, actor_id) values (…)`;
```

## Do not reuse the request audit log

`audit_log` is request-bound: `leave_request_id` is `NOT NULL` and its action CHECK is
`('submitted','approved','rejected')`. A policy event has no request. Forcing one would
either invent a placeholder request or loosen the constraint for everyone. Give policy
changes their own append-only table (`policy_audit_log`) with the employee, leave type,
effective month, previous rate, new rate, actor, and timestamp.

## Required tests

- A create writes one audit row with `previous_rate` = the prior effective rate.
- A same-month change writes a second audit row (`old → new`).
- A same-month same-rate save writes none (`auditWritten: false`).
- A past effective month, an untracked leave type, and an unknown employee are rejected.
- A month already present in `accrual_ledger` for that employee and leave type is rejected with
  409 and leaves `leave_policies` untouched; clean up the ledger row in the test.
- Accrual for a period **before** a change uses the old rate; the period **at/after** it uses
  the new rate. Assert both directions — a one-sided test passes with the wrong predicate.
- Clean up only the test's effective-dated row. `policy_audit_log` is append-only, so audit
  rows stay behind on a disposable test database by design.

See `db/migrations/0004_policy_effective_dating.sql`, `lib/db/policies.ts`,
`lib/db/accrual.ts`, `lib/db/leave.ts`, and `tests/policy-admin.integration.test.ts`.

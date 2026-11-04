# Accrual idempotency

Monthly accrual (US-07 / BR-06) is additive, and the same month must never be
applied twice. Two obvious markers do not work:

- **In-memory "last run" state** — lost on every deploy and different per instance.
- **`leave_balances.updated_at`** — any balance mutation bumps it (an approved
  request, a manual correction), so it cannot distinguish "accrued this month"
  from "changed this month".

Use a ledger with a unique key per unit of work:

```sql
create table accrual_ledger (
  user_id uuid not null,
  leave_type_id uuid not null,
  period date not null,          -- UTC month start, YYYY-MM-01
  days numeric(6, 2) not null,
  unique (user_id, leave_type_id, period),
  check (extract(day from period) = 1)
);
```

Apply the ledger insert and the balance credit in **one statement**:

```sql
with eligible as ( /* policies where tracks_balance and accrual_per_month > 0 */ ),
recorded as (
  insert into accrual_ledger (user_id, leave_type_id, period, days)
  select user_id, leave_type_id, $1::date, days from eligible
  on conflict (user_id, leave_type_id, period) do nothing
  returning user_id, leave_type_id, days
)
insert into leave_balances (user_id, leave_type_id, balance)
select user_id, leave_type_id, days from recorded
on conflict (user_id, leave_type_id)
do update set balance = leave_balances.balance + excluded.balance;
```

Why this shape:

- `ON CONFLICT DO NOTHING` makes a repeat run read an empty `recorded` set, so
  the second insert credits nothing — the no-op is decided by the database, not
  by application timing.
- One statement keeps the ledger and the balance atomic; the ledger can never
  claim an accrual that was not credited.
- The key is per `(user, leave type, month)`, so a user added mid-month accrues
  on the next run, and concurrent triggers are safe.
- Numeric columns only; never add accrual in JavaScript floats.

## Required tests

- Run once: each tracked policy balance increases by exactly `accrual_per_month`.
- Run again in the same month: zero rows recorded, balances unchanged.
- `tracks_balance = false` (Unpaid) and zero-rate policies never produce a row.
- Snapshot and restore balances in `afterAll`, and delete only the test period's
  ledger rows, so the rest of the DB suite keeps its seeded expectations.

See `db/migrations/0002_accrual_ledger.sql`, `lib/db/accrual.ts`, and
`tests/leave-accrual.integration.test.ts`.

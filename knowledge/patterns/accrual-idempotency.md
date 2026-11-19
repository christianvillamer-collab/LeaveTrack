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
- The ledger is **append-only** (E2-17). `0009_accrual_ledger_guard_and_references.sql`
  installs a `BEFORE DELETE OR UPDATE` trigger that raises `accrual_ledger is append-only`,
  and revokes `EXECUTE` on the trigger function from `PUBLIC`, `anon`, and `authenticated`.
  A purge followed by a rerun must never silently double-accrue; correcting a bad run needs an
  explicit, separately signed-off compensating entry, not a rewrite of history.

The `days` value itself is resolved per month, not read from a single mutable row: a rate
change must affect only later periods. The ledger makes the run idempotent; effective dating
makes it correct. See `knowledge/patterns/effective-dated-policy.md`.

## Reading "last accrual" back

The same reasoning applies to the read side. `lastAccruedAt` must come from the
ledger, not from `leave_balances.updated_at`:

```sql
select max(created_at) as last_accrued_at
from accrual_ledger
where user_id = $1 and leave_type_id = $2
```

- `created_at` is the **run time**; `period` is the **month marker**. Show it as
  "Last accrual <date>", keep `period` for idempotency. Approvals can change
  confirmed balances after that date, so never label the date a balance
  snapshot. Both columns are immutable once written — the append-only trigger
  rejects UPDATE as well as DELETE, so `lastAccruedAt` cannot be backdated.
- No ledger row means no accrual has ever run — return `null` and render
  "No accrual", never `new Date()` or the balance row's timestamp.
- Untracked types (`tracks_balance = false`) are always `null`, even if a stray
  ledger row exists.
- Keep the field nullable through the whole stack (`LeaveBalance.lastAccruedAt`,
  API responses, every render site) so callers cannot accidentally format a
  fabricated value.

## Required tests

- Run once: each tracked policy balance increases by exactly `accrual_per_month`.
- Run again in the same month: zero rows recorded, balances unchanged.
- `tracks_balance = false` (Unpaid) and zero-rate policies never produce a row.
- An approval after an accrual run leaves `lastAccruedAt` unchanged (the
  `leave_balances` update trigger must not be conflated with an accrual).
- A run sets `lastAccruedAt` to that ledger row's `created_at`, and a balance
  read with no ledger row returns `null`.
- Snapshot and restore balances in `afterAll`, but **never delete ledger rows** — the
  trigger rejects it. Pick a run-unique period beyond the current `max(period)` and insert with
  `on conflict (user_id, leave_type_id, period) do nothing`, so a repeated suite run is a no-op
  and the rest of the DB suite keeps its seeded expectations.
- A negative test that DELETE and UPDATE of a ledger row both raise `accrual_ledger is append-only`.

See `db/migrations/0002_accrual_ledger.sql`,
`db/migrations/0009_accrual_ledger_guard_and_references.sql`, `lib/db/accrual.ts`, and
`tests/leave-accrual.integration.test.ts`.

## Org-level accrual status

A dashboard summary needs one row, not one per user:

```sql
select
  max(period)::text as last_period,
  max(created_at) as last_run_at,
  (count(distinct user_id) filter (
    where period = (select max(period) from accrual_ledger)
  ))::int as people_processed
from accrual_ledger
```

- `lastPeriod` and `lastRunAt` answer different questions: the month that was accrued versus when
  the job ran. Keep both, and never derive one from the other.
- `nextRunAt` is `lastPeriod + 1 month`, **not** `lastRunAt + 1 month`. A late run for November
  still means December is next; using `created_at` would schedule 30 days after a delayed run.
- `peopleProcessed` counts users in the latest period only, so it drops if someone leaves or loses
  a tracked policy instead of freezing the first run's headcount.
- With an empty ledger return `{ lastPeriod: null, lastRunAt: null, nextRunAt: null,
peopleProcessed: 0 }` and render "No accrual has run yet" / "—". Never substitute `new Date()`.

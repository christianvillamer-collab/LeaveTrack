-- TASK-017 / US-07: monthly accrual must be idempotent per month.
--
-- leave_balances.updated_at cannot act as the month marker because any balance
-- mutation (an approved request, for example) bumps it. The ledger records
-- exactly which (user, leave type, month) accruals have been applied, so a
-- repeated run inserts nothing and credits nothing.

create table accrual_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  leave_type_id uuid not null references leave_types (id) on delete restrict,
  period date not null,
  days numeric(6, 2) not null check (days > 0),
  created_at timestamptz not null default now(),
  constraint accrual_ledger_period_is_month_start check (extract(day from period) = 1),
  unique (user_id, leave_type_id, period)
);

create index accrual_ledger_period_idx on accrual_ledger (period);

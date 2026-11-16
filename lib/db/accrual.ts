import "server-only";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { isAccrualPeriod } from "@/lib/domain/accrual";
import type { AccrualResult, AccrualSummary } from "@/lib/types";

interface AccrualResultRow {
  users_accrued: number;
  balances_accrued: number;
  total_days: string;
}

interface AccrualStatusRow {
  last_period: string | null;
  last_run_at: Date | null;
  people_processed: number | null;
}

/** `period + 1 month`, kept as a `YYYY-MM-01` string like the ledger column. */
function nextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);

  if (!year || !month) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, "An accrual period is malformed.", 500);
  }

  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

/**
 * Org-level accrual status. `accrual_ledger` is the only source: a balance
 * mutation (an approval, for example) bumps `leave_balances.updated_at`, so
 * that column cannot mark a monthly run (ADR-E002).
 */
export async function getAccrualSummary(): Promise<AccrualSummary> {
  const rows = await getDb()<AccrualStatusRow[]>`
    select
      max(period)::text as last_period,
      max(created_at) as last_run_at,
      (count(distinct user_id) filter (
        where period = (select max(period) from accrual_ledger)
      ))::int as people_processed
    from accrual_ledger
  `;

  const row = rows[0];
  const lastPeriod = row?.last_period ?? null;

  return {
    lastPeriod,
    lastRunAt: row?.last_run_at ? row.last_run_at.toISOString() : null,
    nextRunAt: lastPeriod ? nextPeriod(lastPeriod) : null,
    peopleProcessed: Number(row?.people_processed ?? 0),
  };
}

/**
 * Applies one month of accrual in a single statement.
 *
 * The `recorded` CTE inserts the (user, leave type, month) ledger rows and
 * keeps only the ones that were actually new, so a repeated run reads an empty
 * set and credits nothing. `applied` then upserts exactly those rows into
 * leave_balances. Because both writes live in one statement, the ledger can
 * never claim an accrual that was not credited, or vice versa.
 */
export async function runAccrual(period: string): Promise<AccrualResult> {
  if (!isAccrualPeriod(period)) {
    throw AppError.validation("The accrual period must be the first day of a month (YYYY-MM-01).");
  }

  const rows = await getDb()<AccrualResultRow[]>`
    with effective as (
      select distinct on (p.user_id, p.leave_type_id)
        p.user_id,
        p.leave_type_id,
        p.accrual_per_month as days
      from leave_policies p
      where p.effective_from <= ${period}::date
      order by p.user_id, p.leave_type_id, p.effective_from desc
    ),
    eligible as (
      select
        e.user_id,
        e.leave_type_id,
        e.days
      from effective e
      join leave_types t
        on t.id = e.leave_type_id
       and t.tracks_balance = true
      where e.days > 0
    ),
    recorded as (
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      select user_id, leave_type_id, ${period}::date, days
      from eligible
      on conflict (user_id, leave_type_id, period) do nothing
      returning user_id, leave_type_id, days
    ),
    applied as (
      insert into leave_balances (user_id, leave_type_id, balance)
      select user_id, leave_type_id, days
      from recorded
      on conflict (user_id, leave_type_id)
      do update set balance = leave_balances.balance + excluded.balance
      returning user_id
    )
    select
      (select count(distinct user_id) from recorded)::int as users_accrued,
      (select count(*) from recorded)::int as balances_accrued,
      (select coalesce(sum(days), 0) from recorded)::text as total_days
  `;

  const row = rows[0];

  return {
    period,
    usersAccrued: Number(row?.users_accrued ?? 0),
    balancesAccrued: Number(row?.balances_accrued ?? 0),
    totalDays: Number(row?.total_days ?? 0),
  };
}

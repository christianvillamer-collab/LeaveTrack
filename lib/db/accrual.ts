import "server-only";

import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { isAccrualPeriod } from "@/lib/domain/accrual";
import type { AccrualResult } from "@/lib/types";

interface AccrualSummaryRow {
  users_accrued: number;
  balances_accrued: number;
  total_days: string;
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

  const rows = await getDb()<AccrualSummaryRow[]>`
    with eligible as (
      select
        p.user_id,
        p.leave_type_id,
        p.accrual_per_month as days
      from leave_policies p
      join leave_types t
        on t.id = p.leave_type_id
       and t.tracks_balance = true
      where p.accrual_per_month > 0
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

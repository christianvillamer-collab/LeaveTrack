import "server-only";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import type { LeaveType, PolicyChange, PolicyOverview, PolicyRateResult } from "@/lib/types";

interface PolicyOverviewRow {
  id: string;
  name: string;
  tracks_balance: boolean;
  accrual_per_month: string | null;
  assigned_employees: number;
}

interface LeaveTypeRow {
  id: string;
  name: string;
  tracks_balance: boolean;
}

interface PolicyChangeRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  leave_type_id: string;
  leave_type_name: string;
  tracks_balance: boolean;
  effective_from: string;
  previous_rate: string | null;
  new_rate: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
  changed_at: Date;
}

function isLeaveTypeName(name: string): name is LeaveType["name"] {
  return name === "Vacation" || name === "Sick" || name === "Unpaid";
}

function toLeaveType(row: { id: string; name: string; tracks_balance: boolean }): LeaveType {
  if (!isLeaveTypeName(row.name)) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      "A configured leave type is not supported by this workspace.",
      500,
    );
  }

  return { id: row.id, name: row.name, tracksBalance: row.tracks_balance };
}

/** The current UTC month as `YYYY-MM-01`, matching `accrual_ledger.period`. */
function currentUtcMonth(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return `${now.getUTCFullYear()}-${month}-01`;
}

/**
 * The HR policy snapshot, grouped from the rate in effect today for each
 * employee. Historical and future rows are excluded first, so a pending rate
 * change cannot inflate the snapshot before its month arrives.
 */
export async function listPolicyOverview(): Promise<PolicyOverview[]> {
  const rows = await getDb()<PolicyOverviewRow[]>`
    with current_rates as (
      select distinct on (p.user_id, p.leave_type_id)
        p.user_id,
        p.leave_type_id,
        p.accrual_per_month
      from leave_policies p
      where p.effective_from <= (now() at time zone 'utc')::date
      order by p.user_id, p.leave_type_id, p.effective_from desc
    )
    select
      lt.id,
      lt.name,
      lt.tracks_balance,
      max(cr.accrual_per_month) as accrual_per_month,
      count(distinct cr.user_id)::int as assigned_employees
    from leave_types lt
    left join current_rates cr on cr.leave_type_id = lt.id
    group by lt.id, lt.name, lt.tracks_balance
    order by
      case lt.name
        when 'Vacation' then 1
        when 'Sick' then 2
        when 'Unpaid' then 3
        else 4
      end,
      lt.name
  `;

  return rows.map((row) => ({
    leaveType: toLeaveType(row),
    accrualPerMonth: Number(row.accrual_per_month ?? 0),
    assignedEmployees: Number(row.assigned_employees ?? 0),
  }));
}

export interface UpsertPolicyRateInput {
  actorId: string;
  userId: string;
  leaveTypeId: string;
  accrualPerMonth: number;
  effectiveFrom: string;
}

/**
 * Creates or corrects an employee's rate for one effective month and records
 * exactly one append-only audit row for a real change. The rate applies to that
 * month and every later month; past months are rejected, and the current month
 * is rejected once it has already accrued. A save that leaves the same
 * effective month at the same rate writes no audit row.
 */
export async function upsertPolicyRate({
  actorId,
  userId,
  leaveTypeId,
  accrualPerMonth,
  effectiveFrom,
}: UpsertPolicyRateInput): Promise<PolicyRateResult> {
  if (effectiveFrom < currentUtcMonth()) {
    throw AppError.validation("Policy changes cannot apply to a past month.");
  }

  return getDb().begin(async (tx) => {
    const [user] = await tx<{ id: string }[]>`
      select id from users where id = ${userId} limit 1
    `;

    if (!user) {
      throw AppError.notFound("No employee record matches that account.");
    }

    const [leaveType] = await tx<LeaveTypeRow[]>`
      select id, name, tracks_balance
      from leave_types
      where id = ${leaveTypeId}
      limit 1
    `;

    if (!leaveType) {
      throw AppError.validation("Select a valid leave type.");
    }

    if (!leaveType.tracks_balance) {
      throw AppError.validation("Only balance-tracked leave types can carry a policy rate.");
    }

    // A correction to this same effective month replaces its old rate; a new
    // month inherits the rate that was in effect before it.
    const [sameMonth] = await tx<{ accrual_per_month: string }[]>`
      select accrual_per_month
      from leave_policies
      where user_id = ${userId}
        and leave_type_id = ${leaveTypeId}
        and effective_from = ${effectiveFrom}::date
      limit 1
    `;

    const [earlier] = await tx<{ accrual_per_month: string }[]>`
      select accrual_per_month
      from leave_policies
      where user_id = ${userId}
        and leave_type_id = ${leaveTypeId}
        and effective_from < ${effectiveFrom}::date
      order by effective_from desc
      limit 1
    `;

    const previousRate = sameMonth
      ? Number(sameMonth.accrual_per_month)
      : earlier
        ? Number(earlier.accrual_per_month)
        : null;

    if (sameMonth && Number(sameMonth.accrual_per_month) === accrualPerMonth) {
      return {
        userId,
        leaveTypeId,
        accrualPerMonth,
        effectiveFrom,
        previousRate,
        auditWritten: false,
      };
    }

    // `accrual_ledger` is the idempotency marker for a month (ADR-E002). Once
    // this (user, leave type, month) has accrued, a rate saved for that same
    // month can never affect it — the run inserts nothing for the period. Reject
    // instead of recording a change that silently will not apply.
    const [accrued] = await tx<{ id: string }[]>`
      select id
      from accrual_ledger
      where user_id = ${userId}
        and leave_type_id = ${leaveTypeId}
        and period = ${effectiveFrom}::date
      limit 1
    `;

    if (accrued) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "This month has already accrued for this leave type; choose the next month.",
        409,
      );
    }

    const [saved] = await tx<{ accrual_per_month: string; effective_from: string }[]>`
      insert into leave_policies (user_id, leave_type_id, accrual_per_month, effective_from)
      values (${userId}, ${leaveTypeId}, ${accrualPerMonth}, ${effectiveFrom}::date)
      on conflict (user_id, leave_type_id, effective_from)
      do update set accrual_per_month = excluded.accrual_per_month
      returning accrual_per_month, effective_from::text as effective_from
    `;

    if (!saved) {
      throw AppError.internal("The policy rate could not be saved.");
    }

    await tx`
      insert into policy_audit_log (
        user_id,
        leave_type_id,
        effective_from,
        previous_rate,
        new_rate,
        actor_id
      )
      values (
        ${userId},
        ${leaveTypeId},
        ${effectiveFrom}::date,
        ${previousRate},
        ${accrualPerMonth},
        ${actorId}
      )
    `;

    return {
      userId,
      leaveTypeId,
      accrualPerMonth: Number(saved.accrual_per_month),
      effectiveFrom: saved.effective_from,
      previousRate,
      auditWritten: true,
    };
  });
}

/** Most recent policy changes, joined for the HR page's audit table. */
export async function listPolicyChangeLog(limit = 10): Promise<PolicyChange[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

  const rows = await getDb()<PolicyChangeRow[]>`
    select
      pal.id,
      pal.user_id,
      employee.name as user_name,
      employee.email as user_email,
      pal.leave_type_id,
      lt.name as leave_type_name,
      lt.tracks_balance,
      pal.effective_from::text as effective_from,
      pal.previous_rate,
      pal.new_rate,
      pal.actor_id,
      actor.name as actor_name,
      actor.email as actor_email,
      pal.changed_at
    from policy_audit_log pal
    join users employee on employee.id = pal.user_id
    join leave_types lt on lt.id = pal.leave_type_id
    join users actor on actor.id = pal.actor_id
    order by pal.changed_at desc, pal.id desc
    limit ${boundedLimit}
  `;

  return rows.map((row) => ({
    id: row.id,
    employee: { id: row.user_id, name: row.user_name, email: row.user_email },
    leaveType: toLeaveType({
      id: row.leave_type_id,
      name: row.leave_type_name,
      tracks_balance: row.tracks_balance,
    }),
    effectiveFrom: row.effective_from,
    previousRate: row.previous_rate === null ? null : Number(row.previous_rate),
    newRate: Number(row.new_rate),
    actor: { id: row.actor_id, name: row.actor_name, email: row.actor_email },
    changedAt: row.changed_at.toISOString(),
  }));
}

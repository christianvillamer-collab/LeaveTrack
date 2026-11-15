import "server-only";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import type { LeaveType, PolicyOverview } from "@/lib/types";

interface PolicyOverviewRow {
  id: string;
  name: string;
  tracks_balance: boolean;
  accrual_per_month: string | null;
  assigned_employees: number;
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

/**
 * The HR policy snapshot, grouped from `leave_policies`. Accrual is configured
 * per employee, so a leave type can carry more than one rate; the snapshot
 * reports the highest configured rate and how many people it applies to.
 */
export async function listPolicyOverview(): Promise<PolicyOverview[]> {
  const rows = await getDb()<PolicyOverviewRow[]>`
    select
      lt.id,
      lt.name,
      lt.tracks_balance,
      max(p.accrual_per_month) as accrual_per_month,
      count(distinct p.user_id)::int as assigned_employees
    from leave_types lt
    left join leave_policies p on p.leave_type_id = lt.id
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

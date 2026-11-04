import "server-only";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { evaluateBalanceWarning } from "@/lib/domain/leave";
import { listDirectReports } from "@/lib/db/users";
import type {
  CreateLeaveRequestResult,
  LeaveBalance,
  LeaveDecisionResult,
  LeaveType,
  MyLeaveData,
  MyLeaveRequest,
  RequestStatus,
  TeamLeaveData,
  TeamLeaveRequest,
} from "@/lib/types";
import { countLeaveDays, formatDateRange, formatDays } from "@/lib/utils/format";

interface LeaveTypeRow {
  id: string;
  name: string;
  tracks_balance: boolean;
}

interface BalanceRow extends LeaveTypeRow {
  balance: string | null;
  updated_at: Date | null;
  accrual_per_month: string | null;
  pending_days: string | null;
}

interface UserRow {
  id: string;
  manager_id: string | null;
}

interface InsertedRequestRow {
  id: string;
  created_at: Date;
}

interface MyLeaveRequestRow {
  id: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  created_at: Date;
  leave_type_id: string;
  leave_type_name: string;
  tracks_balance: boolean;
}

interface TeamLeaveRequestRow extends MyLeaveRequestRow {
  reason: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
}

interface DecisionRow {
  id: string;
  user_id: string;
  leave_type_id: string;
  days: number;
  status: string;
  manager_id: string | null;
  leave_type_name: string;
  tracks_balance: boolean;
}

export interface CreateLeaveRequestInput {
  userId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface DecideLeaveRequestInput {
  requestId: string;
  managerId: string;
  managerName: string;
  decision: "approved" | "rejected";
  reason?: string;
}

function isLeaveTypeName(name: string): name is LeaveType["name"] {
  return name === "Vacation" || name === "Sick" || name === "Unpaid";
}

function toLeaveType(row: LeaveTypeRow): LeaveType {
  if (!isLeaveTypeName(row.name)) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      "A configured leave type is not supported by this workspace.",
      500,
    );
  }

  return {
    id: row.id,
    name: row.name,
    tracksBalance: row.tracks_balance,
  };
}

export async function listLeaveTypes(): Promise<LeaveType[]> {
  const rows = await getDb()<LeaveTypeRow[]>`
    select id, name, tracks_balance
    from leave_types
    order by
      case name
        when 'Vacation' then 1
        when 'Sick' then 2
        when 'Unpaid' then 3
        else 4
      end,
      name
  `;

  return rows.map(toLeaveType);
}

function toRequestStatus(status: string): RequestStatus {
  if (status === "pending" || status === "approved" || status === "rejected") {
    return status;
  }

  throw new AppError(ERROR_CODES.INTERNAL_ERROR, "A leave request has an unsupported status.", 500);
}

export async function getBalancesForUser(userId: string): Promise<LeaveBalance[]> {
  const rows = await getDb()<BalanceRow[]>`
    select
      lt.id,
      lt.name,
      lt.tracks_balance,
      lb.balance,
      lb.updated_at,
      lp.accrual_per_month,
      pending.pending_days
    from leave_types lt
    left join leave_balances lb
      on lb.leave_type_id = lt.id and lb.user_id = ${userId}
    left join leave_policies lp
      on lp.leave_type_id = lt.id and lp.user_id = ${userId}
    left join (
      select
        leave_type_id,
        sum((end_date - start_date) + 1) as pending_days
      from leave_requests
      where user_id = ${userId}
        and status = 'pending'
        and is_deleted = false
      group by leave_type_id
    ) pending on pending.leave_type_id = lt.id
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
    confirmed: row.tracks_balance ? Number(row.balance ?? 0) : null,
    pending: Number(row.pending_days ?? 0),
    accrualPerMonth: row.accrual_per_month === null ? null : Number(row.accrual_per_month),
    lastAccruedAt: (row.updated_at ?? new Date()).toISOString(),
  }));
}

export async function listMyLeaveRequests(userId: string): Promise<MyLeaveRequest[]> {
  const rows = await getDb()<MyLeaveRequestRow[]>`
    select
      r.id,
      r.start_date::text as start_date,
      r.end_date::text as end_date,
      (r.end_date - r.start_date + 1)::int as days,
      r.status::text as status,
      r.created_at,
      lt.id as leave_type_id,
      lt.name as leave_type_name,
      lt.tracks_balance
    from leave_requests r
    join leave_types lt on lt.id = r.leave_type_id
    where r.user_id = ${userId}
      and r.is_deleted = false
    order by r.created_at desc
  `;

  return rows.map((row) => ({
    id: row.id,
    leaveType: toLeaveType({
      id: row.leave_type_id,
      name: row.leave_type_name,
      tracks_balance: row.tracks_balance,
    }),
    startDate: row.start_date,
    endDate: row.end_date,
    days: Number(row.days),
    status: toRequestStatus(row.status),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getMyLeaveData(userId: string): Promise<MyLeaveData> {
  const [balances, requests] = await Promise.all([
    getBalancesForUser(userId),
    listMyLeaveRequests(userId),
  ]);

  return { balances, requests };
}

/**
 * The direct-report predicate is intentionally in SQL. Never fetch the team
 * and filter by manager in application code.
 */
export async function listTeamLeaveRequests(managerId: string): Promise<TeamLeaveRequest[]> {
  const rows = await getDb()<TeamLeaveRequestRow[]>`
    select
      r.id,
      r.start_date::text as start_date,
      r.end_date::text as end_date,
      (r.end_date - r.start_date + 1)::int as days,
      r.reason,
      r.status::text as status,
      r.created_at,
      e.id as employee_id,
      e.name as employee_name,
      e.email as employee_email,
      lt.id as leave_type_id,
      lt.name as leave_type_name,
      lt.tracks_balance
    from leave_requests r
    join users e on e.id = r.user_id
    join leave_types lt on lt.id = r.leave_type_id
    where e.manager_id = ${managerId}
      and r.is_deleted = false
    order by r.created_at desc
  `;

  return rows.map((row) => ({
    id: row.id,
    employee: {
      id: row.employee_id,
      name: row.employee_name,
      email: row.employee_email,
    },
    leaveType: toLeaveType({
      id: row.leave_type_id,
      name: row.leave_type_name,
      tracks_balance: row.tracks_balance,
    }),
    startDate: row.start_date,
    endDate: row.end_date,
    days: Number(row.days),
    reason: row.reason,
    status: toRequestStatus(row.status),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getTeamLeaveData(managerId: string): Promise<TeamLeaveData> {
  const [requests, directReports] = await Promise.all([
    listTeamLeaveRequests(managerId),
    listDirectReports(managerId),
  ]);

  return { requests, directReports };
}

export async function decideLeaveRequest(
  input: DecideLeaveRequestInput,
): Promise<LeaveDecisionResult> {
  const note = input.reason?.trim() || null;

  if (input.decision === "rejected" && !note) {
    throw AppError.validation("A rejection reason is required.");
  }

  const db = getDb();

  return db.begin(async (tx) => {
    const [row] = await tx<DecisionRow[]>`
      select
        r.id,
        r.user_id,
        r.leave_type_id,
        (r.end_date - r.start_date + 1)::int as days,
        r.status::text as status,
        e.manager_id,
        lt.name as leave_type_name,
        lt.tracks_balance
      from leave_requests r
      join users e on e.id = r.user_id
      join leave_types lt on lt.id = r.leave_type_id
      where r.id = ${input.requestId}
        and r.is_deleted = false
      for update
    `;

    if (!row) {
      throw AppError.notFound("Leave request not found.");
    }

    if (row.manager_id !== input.managerId) {
      throw AppError.forbidden("You can only decide requests from your direct reports.");
    }

    if (row.status !== "pending") {
      throw new AppError(ERROR_CODES.CONFLICT, "This request has already been decided.", 409);
    }

    const leaveType = toLeaveType({
      id: row.leave_type_id,
      name: row.leave_type_name,
      tracks_balance: row.tracks_balance,
    });
    const days = Number(row.days);
    let balance: LeaveDecisionResult["balance"] = null;

    if (input.decision === "approved" && leaveType.tracksBalance) {
      const [balanceRow] = await tx<{ balance: string }[]>`
        select balance
        from leave_balances
        where user_id = ${row.user_id}
          and leave_type_id = ${leaveType.id}
        for update
      `;

      const previous = Number(balanceRow?.balance ?? 0);

      if (!balanceRow || previous < days) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "The employee's confirmed balance is lower than the requested days. HR override is required.",
          409,
        );
      }

      const next = previous - days;

      await tx`
        update leave_balances
        set balance = ${next}
        where user_id = ${row.user_id}
          and leave_type_id = ${leaveType.id}
      `;

      balance = {
        leaveTypeId: leaveType.id,
        leaveTypeName: leaveType.name,
        previous,
        next,
      };
    }

    const decidedAt = new Date();

    await tx`
      update leave_requests
      set status = ${input.decision}::request_status,
          decided_by = ${input.managerId},
          decided_at = ${decidedAt},
          decision_note = ${note}
      where id = ${input.requestId}
    `;

    const detail =
      input.decision === "approved"
        ? balance
          ? `Approved by ${input.managerName}. ${leaveType.name} balance reduced by ${formatDays(days)} (${balance.previous} → ${balance.next}).`
          : `Approved by ${input.managerName}. No balance change.`
        : `Rejected by ${input.managerName}: ${note}. No balance change.`;

    await tx`
      insert into audit_log (
        leave_request_id,
        actor_id,
        action,
        detail
      ) values (
        ${input.requestId},
        ${input.managerId},
        ${input.decision},
        ${detail}
      )
    `;

    return {
      request: {
        id: row.id,
        status: input.decision,
        decidedAt: decidedAt.toISOString(),
      },
      balance,
    };
  });
}

/**
 * Creates the pending request and its submitted audit row atomically.
 * Balance is intentionally not decremented until a manager approves.
 */
export async function createLeaveRequest(
  input: CreateLeaveRequestInput,
): Promise<CreateLeaveRequestResult> {
  const requestedDays = countLeaveDays(input.startDate, input.endDate);

  if (requestedDays < 1) {
    throw AppError.validation("End date cannot be before the start date.");
  }

  const db = getDb();

  return db.begin(async (tx) => {
    const [user] = await tx<UserRow[]>`
      select id, manager_id
      from users
      where id = ${input.userId}
      limit 1
    `;

    if (!user) {
      throw AppError.forbidden("No employee record is linked to this account.");
    }

    const [leaveTypeRow] = await tx<LeaveTypeRow[]>`
      select id, name, tracks_balance
      from leave_types
      where id = ${input.leaveTypeId}
      limit 1
    `;

    if (!leaveTypeRow) {
      throw AppError.validation("Select a valid leave type.");
    }

    const leaveType = toLeaveType(leaveTypeRow);
    let availableDays: number | null = null;

    if (leaveType.tracksBalance) {
      const [balanceRow] = await tx<{ balance: string }[]>`
        select balance
        from leave_balances
        where user_id = ${input.userId}
          and leave_type_id = ${leaveType.id}
        limit 1
      `;

      availableDays = Number(balanceRow?.balance ?? 0);
    }

    const warning = evaluateBalanceWarning({
      tracksBalance: leaveType.tracksBalance,
      requestedDays,
      availableDays,
    });

    const [inserted] = await tx<InsertedRequestRow[]>`
      insert into leave_requests (
        user_id,
        leave_type_id,
        start_date,
        end_date,
        reason
      ) values (
        ${input.userId},
        ${leaveType.id},
        ${input.startDate},
        ${input.endDate},
        ${input.reason}
      )
      returning id, created_at
    `;

    if (!inserted) {
      throw AppError.internal("The leave request could not be created.");
    }

    await tx`
      insert into audit_log (
        leave_request_id,
        actor_id,
        action,
        detail
      ) values (
        ${inserted.id},
        ${input.userId},
        'submitted',
        ${`Leave request submitted for ${formatDateRange(input.startDate, input.endDate)} (${formatDays(requestedDays)}).`}
      )
    `;

    return {
      request: {
        id: inserted.id,
        status: "pending" as const,
        leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        days: requestedDays,
        createdAt: inserted.created_at.toISOString(),
      },
      warning,
      managerNotified: user.manager_id !== null,
    };
  });
}

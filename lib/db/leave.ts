import "server-only";

import type { TransactionSql } from "postgres";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { Role } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";

type Db = ReturnType<typeof getDb>;
import { evaluateBalanceWarning } from "@/lib/domain/leave";
import { listDirectReports } from "@/lib/db/users";
import { enqueueNotifications } from "@/lib/db/notifications";
import { buildNotificationEmail } from "@/lib/notifications/email-template";
import type {
  CreateLeaveRequestResult,
  LeaveBalance,
  LeaveDecisionResult,
  LeaveRequestDetail,
  LeaveRequestListOptions,
  LeaveType,
  MyLeaveData,
  MyLeaveRequest,
  Paginated,
  RequestStatus,
  RequestSummary,
  TeamLeaveData,
  TeamLeaveRequest,
} from "@/lib/types";
import { toPaginationMeta } from "@/lib/validation/list";
import {
  countLeaveDays,
  formatDateRange,
  formatDays,
  formatRequestReference,
} from "@/lib/utils/format";

/** Mirrors `leave_balances_balance_check` in migration 0007. */
const MIN_OVERDRAWN_BALANCE = -10000;

interface LeaveTypeRow {
  id: string;
  name: string;
  tracks_balance: boolean;
}

interface BalanceRow extends LeaveTypeRow {
  balance: string | null;
  last_accrued_at: Date | null;
  accrual_per_month: string | null;
  pending_days: string | null;
}

interface UserRow {
  id: string;
  name: string;
  manager_id: string | null;
}

interface InsertedRequestRow {
  id: string;
  created_at: Date;
}

interface MyLeaveRequestRow {
  total: number;
  id: string;
  reference: string;
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

interface ScopedRequestRow extends MyLeaveRequestRow {
  employee_id: string;
  employee_name: string;
  employee_email: string;
}

interface RequestDetailRow {
  id: string;
  reference: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  reason: string;
  created_at: Date;
  decided_at: Date | null;
  decision_note: string | null;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  manager_id: string | null;
  manager_name: string | null;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decided_by_email: string | null;
  leave_type_id: string;
  leave_type_name: string;
  tracks_balance: boolean;
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
  start_date: string;
  end_date: string;
  employee_name: string;
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

export interface OverrideLeaveRequestInput {
  requestId: string;
  actorId: string;
  actorName: string;
  decision: "approved" | "rejected";
  reason: string;
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

interface RequestQueryOptions {
  status?: RequestStatus;
  page?: number;
  pageSize?: number;
}

function listBounds(options?: RequestQueryOptions) {
  const page = options?.page;
  const pageSize = options?.pageSize;
  const paged = page !== undefined && pageSize !== undefined;

  return {
    status: options?.status ?? null,
    limit: paged ? pageSize : null,
    offset: paged ? (page - 1) * pageSize : null,
  };
}

/**
 * Count queries reuse the exact row WHERE fragments. `count(*) over ()` cannot
 * report a total when OFFSET returns zero rows, so an empty page falls back to
 * one of these counts with the same predicates.
 */
function myRequestFilter(db: Db, userId: string, status: RequestStatus | null) {
  return db`
    r.user_id = ${userId}
    and r.is_deleted = false
    and (${status}::request_status is null or r.status = ${status}::request_status)
  `;
}

function teamRequestFilter(db: Db, managerId: string, status: RequestStatus | null) {
  return db`
    e.manager_id = ${managerId}
    and r.is_deleted = false
    and (${status}::request_status is null or r.status = ${status}::request_status)
  `;
}

function orgRequestFilter(db: Db, status: RequestStatus | null) {
  return db`
    r.is_deleted = false
    and (${status}::request_status is null or r.status = ${status}::request_status)
  `;
}

function rowPagination(total: number, options: LeaveRequestListOptions) {
  return toPaginationMeta(total, options.page, options.pageSize);
}

export async function getBalancesForUser(userId: string): Promise<LeaveBalance[]> {
  const rows = await getDb()<BalanceRow[]>`
    select
      lt.id,
      lt.name,
      lt.tracks_balance,
      lb.balance,
      accrued.last_accrued_at,
      lp.accrual_per_month,
      pending.pending_days
    from leave_types lt
    left join leave_balances lb
      on lb.leave_type_id = lt.id and lb.user_id = ${userId}
    left join lateral (
      select p.accrual_per_month
      from leave_policies p
      where p.user_id = ${userId}
        and p.leave_type_id = lt.id
        and p.effective_from <= (now() at time zone 'utc')::date
      order by p.effective_from desc
      limit 1
    ) lp on true
    left join (
      select
        leave_type_id,
        max(created_at) as last_accrued_at
      from accrual_ledger
      where user_id = ${userId}
      group by leave_type_id
    ) accrued on accrued.leave_type_id = lt.id
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
    lastAccruedAt:
      row.tracks_balance && row.last_accrued_at ? row.last_accrued_at.toISOString() : null,
  }));
}

function toMyLeaveRequest(row: MyLeaveRequestRow): MyLeaveRequest {
  return {
    id: row.id,
    reference: formatRequestReference(row.reference),
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
  };
}

async function queryMyLeaveRequests(
  userId: string,
  options?: RequestQueryOptions,
): Promise<MyLeaveRequestRow[]> {
  const db = getDb();
  const { status, limit, offset } = listBounds(options);
  const filter = myRequestFilter(db, userId, status);

  return db<MyLeaveRequestRow[]>`
    select
      count(*) over ()::int as total,
      r.id,
      r.reference,
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
    where ${filter}
    order by r.created_at desc, r.id desc
    limit ${limit}
    offset ${offset}
  `;
}

async function countMyLeaveRequests(userId: string, status: RequestStatus | null): Promise<number> {
  const db = getDb();
  const [row] = await db<{ total: number }[]>`
    select count(*)::int as total
    from leave_requests r
    where ${myRequestFilter(db, userId, status)}
  `;
  return row?.total ?? 0;
}

export async function listMyLeaveRequests(userId: string): Promise<MyLeaveRequest[]> {
  const rows = await queryMyLeaveRequests(userId);
  return rows.map(toMyLeaveRequest);
}

export async function listMyLeaveRequestsPage(
  userId: string,
  options: LeaveRequestListOptions,
): Promise<Paginated<MyLeaveRequest>> {
  const rows = await queryMyLeaveRequests(userId, options);
  const total = rows[0]?.total ?? (await countMyLeaveRequests(userId, options.status ?? null));

  return {
    items: rows.map(toMyLeaveRequest),
    pagination: rowPagination(total, options),
  };
}

export async function getMyLeaveData(userId: string): Promise<MyLeaveData> {
  const [balances, requests] = await Promise.all([
    getBalancesForUser(userId),
    listMyLeaveRequests(userId),
  ]);

  return { balances, requests };
}

export interface ScopedActor {
  id: string;
  role: Role;
}

function scopedRequestFilter(db: Db, actor: ScopedActor, status: RequestStatus | null) {
  return db`
    r.is_deleted = false
    and (
      (${actor.role} = 'employee' and r.user_id = ${actor.id})
      or (
        ${actor.role} = 'manager'
        and (r.user_id = ${actor.id} or e.manager_id = ${actor.id})
      )
      or (${actor.role} = 'hr_admin')
    )
    and (${status}::request_status is null or r.status = ${status}::request_status)
  `;
}

/**
 * The scoped `/requests` list. Role picks the branch, but every scope predicate
 * stays in SQL: employees read their own rows, managers read their own plus
 * direct reports (`e.manager_id = :current_user_id`), and HR reads all. Unknown
 * roles match no branch, so the default is deny.
 */
function toRequestSummary(row: ScopedRequestRow): RequestSummary {
  return {
    id: row.id,
    reference: formatRequestReference(row.reference),
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
    status: toRequestStatus(row.status),
    createdAt: row.created_at.toISOString(),
  };
}

async function queryScopedLeaveRequests(
  actor: ScopedActor,
  options?: RequestQueryOptions,
): Promise<ScopedRequestRow[]> {
  const db = getDb();
  const { status, limit, offset } = listBounds(options);
  const filter = scopedRequestFilter(db, actor, status);

  return db<ScopedRequestRow[]>`
    select
      count(*) over ()::int as total,
      r.id,
      r.reference,
      r.start_date::text as start_date,
      r.end_date::text as end_date,
      (r.end_date - r.start_date + 1)::int as days,
      r.status::text as status,
      r.created_at,
      lt.id as leave_type_id,
      lt.name as leave_type_name,
      lt.tracks_balance,
      e.id as employee_id,
      e.name as employee_name,
      e.email as employee_email
    from leave_requests r
    join users e on e.id = r.user_id
    join leave_types lt on lt.id = r.leave_type_id
    where ${filter}
    order by r.created_at desc, r.id desc
    limit ${limit}
    offset ${offset}
  `;
}

async function countScopedLeaveRequests(
  actor: ScopedActor,
  status: RequestStatus | null,
): Promise<number> {
  const db = getDb();
  const [row] = await db<{ total: number }[]>`
    select count(*)::int as total
    from leave_requests r
    join users e on e.id = r.user_id
    where ${scopedRequestFilter(db, actor, status)}
  `;
  return row?.total ?? 0;
}

export async function listScopedLeaveRequests(actor: ScopedActor): Promise<RequestSummary[]> {
  const rows = await queryScopedLeaveRequests(actor);
  return rows.map(toRequestSummary);
}

export async function listScopedLeaveRequestsPage(
  actor: ScopedActor,
  options: LeaveRequestListOptions,
): Promise<Paginated<RequestSummary>> {
  const rows = await queryScopedLeaveRequests(actor, options);
  const total = rows[0]?.total ?? (await countScopedLeaveRequests(actor, options.status ?? null));

  return {
    items: rows.map(toRequestSummary),
    pagination: rowPagination(total, options),
  };
}

/** One active (not soft-deleted) request with its owner, manager, and decision. */
export async function getLeaveRequestDetail(requestId: string): Promise<LeaveRequestDetail | null> {
  const rows = await getDb()<RequestDetailRow[]>`
    select
      r.id,
      r.reference,
      r.start_date::text as start_date,
      r.end_date::text as end_date,
      (r.end_date - r.start_date + 1)::int as days,
      r.status::text as status,
      r.reason,
      r.created_at,
      r.decided_at,
      r.decision_note,
      e.id as employee_id,
      e.name as employee_name,
      e.email as employee_email,
      e.manager_id,
      m.name as manager_name,
      d.id as decided_by_id,
      d.name as decided_by_name,
      d.email as decided_by_email,
      lt.id as leave_type_id,
      lt.name as leave_type_name,
      lt.tracks_balance
    from leave_requests r
    join users e on e.id = r.user_id
    left join users m on m.id = e.manager_id
    left join users d on d.id = r.decided_by
    join leave_types lt on lt.id = r.leave_type_id
    where r.id = ${requestId}
      and r.is_deleted = false
    limit 1
  `;

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    reference: formatRequestReference(row.reference),
    employee: {
      id: row.employee_id,
      name: row.employee_name,
      email: row.employee_email,
      managerId: row.manager_id,
      managerName: row.manager_name,
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
    decidedBy:
      row.decided_by_id && row.decided_by_name
        ? { id: row.decided_by_id, name: row.decided_by_name, email: row.decided_by_email ?? "" }
        : null,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
  };
}

function toTeamLeaveRequest(row: TeamLeaveRequestRow): TeamLeaveRequest {
  return {
    id: row.id,
    reference: formatRequestReference(row.reference),
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
  };
}

/**
 * The direct-report predicate is intentionally in SQL. Never fetch the team
 * and filter by manager in application code.
 */
async function queryTeamLeaveRequests(
  managerId: string,
  options?: RequestQueryOptions,
): Promise<TeamLeaveRequestRow[]> {
  const db = getDb();
  const { status, limit, offset } = listBounds(options);
  const filter = teamRequestFilter(db, managerId, status);

  return db<TeamLeaveRequestRow[]>`
    select
      count(*) over ()::int as total,
      r.id,
      r.reference,
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
    where ${filter}
    order by r.created_at desc, r.id desc
    limit ${limit}
    offset ${offset}
  `;
}

async function countTeamLeaveRequests(
  managerId: string,
  status: RequestStatus | null,
): Promise<number> {
  const db = getDb();
  const [row] = await db<{ total: number }[]>`
    select count(*)::int as total
    from leave_requests r
    join users e on e.id = r.user_id
    where ${teamRequestFilter(db, managerId, status)}
  `;
  return row?.total ?? 0;
}

export async function listTeamLeaveRequests(managerId: string): Promise<TeamLeaveRequest[]> {
  const rows = await queryTeamLeaveRequests(managerId);
  return rows.map(toTeamLeaveRequest);
}

export async function listTeamLeaveRequestsPage(
  managerId: string,
  options: LeaveRequestListOptions,
): Promise<Paginated<TeamLeaveRequest>> {
  const rows = await queryTeamLeaveRequests(managerId, options);
  const total = rows[0]?.total ?? (await countTeamLeaveRequests(managerId, options.status ?? null));

  return {
    items: rows.map(toTeamLeaveRequest),
    pagination: rowPagination(total, options),
  };
}

/**
 * HR-only cross-team queue. This is deliberately a separate query: the manager
 * path keeps its `e.manager_id = :current_user_id` predicate, and HR never
 * passes through `scope=team`.
 */
async function queryOrgLeaveRequests(
  options?: RequestQueryOptions,
): Promise<TeamLeaveRequestRow[]> {
  const db = getDb();
  const { status, limit, offset } = listBounds(options);
  const filter = orgRequestFilter(db, status);

  return db<TeamLeaveRequestRow[]>`
    select
      count(*) over ()::int as total,
      r.id,
      r.reference,
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
    where ${filter}
    order by r.created_at desc, r.id desc
    limit ${limit}
    offset ${offset}
  `;
}

async function countOrgLeaveRequests(status: RequestStatus | null): Promise<number> {
  const db = getDb();
  const [row] = await db<{ total: number }[]>`
    select count(*)::int as total
    from leave_requests r
    where ${orgRequestFilter(db, status)}
  `;
  return row?.total ?? 0;
}

export async function listOrgLeaveRequests(): Promise<TeamLeaveRequest[]> {
  const rows = await queryOrgLeaveRequests();
  return rows.map(toTeamLeaveRequest);
}

export async function listOrgLeaveRequestsPage(
  options: LeaveRequestListOptions,
): Promise<Paginated<TeamLeaveRequest>> {
  const rows = await queryOrgLeaveRequests(options);
  const total = rows[0]?.total ?? (await countOrgLeaveRequests(options.status ?? null));

  return {
    items: rows.map(toTeamLeaveRequest),
    pagination: rowPagination(total, options),
  };
}

export async function getTeamLeaveData(managerId: string): Promise<TeamLeaveData> {
  const [requests, directReports] = await Promise.all([
    listTeamLeaveRequests(managerId),
    listDirectReports(managerId),
  ]);

  return { requests, directReports };
}

interface ApplyDecisionOptions {
  requestId: string;
  actorId: string;
  actorName: string;
  decision: "approved" | "rejected";
  note: string | null;
  isOverride: boolean;
  /** HR-only: permit a negative resulting balance instead of a 409 (E2-11). */
  allowOverBalance: boolean;
  /** Relationship-specific gate; runs after the row lock, before status checks. */
  authorize: (row: DecisionRow) => void;
}

/**
 * A submission with no manager goes to every active HR admin; the submit
 * screen already tells the employee it is an HR review. Recipients are
 * resolved in SQL, never taken from the request body.
 */
async function resolveSubmissionRecipients(
  tx: TransactionSql,
  managerId: string | null,
): Promise<string[]> {
  if (managerId) {
    return [managerId];
  }

  const rows = await tx<{ id: string }[]>`
    select id
    from users
    where role = 'hr_admin'
      and is_active = true
    order by name
  `;

  return rows.map((row) => row.id);
}

/**
 * One transactional decision path for managers and HR overrides. The lock →
 * relationship gate → pending check → balance decrement → status update →
 * audit insert sequence must not fork, or the two modes drift apart. Only the
 * HR override path may cross a short balance; managers keep the 409.
 */
async function applyDecision(options: ApplyDecisionOptions): Promise<LeaveDecisionResult> {
  const { requestId, actorId, actorName, decision, note, isOverride, allowOverBalance, authorize } =
    options;

  return getDb().begin(async (tx) => {
    const [row] = await tx<DecisionRow[]>`
      select
        r.id,
        r.user_id,
        r.leave_type_id,
        (r.end_date - r.start_date + 1)::int as days,
        r.status::text as status,
        e.manager_id,
        r.start_date::text as start_date,
        r.end_date::text as end_date,
        e.name as employee_name,
        lt.name as leave_type_name,
        lt.tracks_balance
      from leave_requests r
      join users e on e.id = r.user_id
      join leave_types lt on lt.id = r.leave_type_id
      where r.id = ${requestId}
        and r.is_deleted = false
      for update
    `;

    if (!row) {
      throw AppError.notFound("Leave request not found.");
    }

    authorize(row);

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
    let overBalance = false;

    if (decision === "approved" && leaveType.tracksBalance) {
      const [balanceRow] = await tx<{ balance: string }[]>`
        select balance
        from leave_balances
        where user_id = ${row.user_id}
          and leave_type_id = ${leaveType.id}
        for update
      `;

      const previous = Number(balanceRow?.balance ?? 0);

      if (!balanceRow || previous < days) {
        if (!allowOverBalance) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            "The employee's confirmed balance is lower than the requested days, so this request cannot be approved.",
            409,
          );
        }

        overBalance = true;
      }

      // An HR over-balance approval records the true (possibly negative)
      // result; it never clamps the balance back to zero.
      const next = previous - days;

      if (next < MIN_OVERDRAWN_BALANCE) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "This approval would exceed the permitted overdrawn balance limit.",
          409,
        );
      }

      if (!balanceRow) {
        // A tracked type should always have a row, but an HR over-balance
        // approval must still record the result if one is missing.
        await tx`
          insert into leave_balances (user_id, leave_type_id, balance)
          values (${row.user_id}, ${leaveType.id}, ${next})
        `;
      } else {
        await tx`
          update leave_balances
          set balance = ${next}
          where user_id = ${row.user_id}
            and leave_type_id = ${leaveType.id}
        `;
      }

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
      set status = ${decision}::request_status,
          decided_by = ${actorId},
          decided_at = ${decidedAt},
          decision_note = ${note}
      where id = ${requestId}
    `;

    // Distinct audit actions make overrides filterable without parsing the
    // detail prefix (E2-11). Manager decisions keep the original values.
    const auditAction = isOverride
      ? decision === "approved"
        ? "hr_override_approved"
        : "hr_override_rejected"
      : decision;

    const detail = isOverride
      ? decision === "approved"
        ? balance
          ? overBalance
            ? `HR override — approved by ${actorName}: ${note}. Over-balance approval: ${leaveType.name} balance reduced by ${formatDays(days)} (${balance.previous} → ${balance.next}).`
            : `HR override — approved by ${actorName}: ${note}. ${leaveType.name} balance reduced by ${formatDays(days)} (${balance.previous} → ${balance.next}).`
          : `HR override — approved by ${actorName}: ${note}. No balance change.`
        : `HR override — rejected by ${actorName}: ${note}. No balance change.`
      : decision === "approved"
        ? balance
          ? `Approved by ${actorName}. ${leaveType.name} balance reduced by ${formatDays(days)} (${balance.previous} → ${balance.next}).`
          : `Approved by ${actorName}. No balance change.`
        : `Rejected by ${actorName}: ${note}. No balance change.`;

    await tx`
      insert into audit_log (
        leave_request_id,
        actor_id,
        action,
        detail
      ) values (
        ${requestId},
        ${actorId},
        ${auditAction},
        ${detail}
      )
    `;

    // Same transaction as the decision: the outbox row either commits with it
    // or not at all. Delivery is the cron worker's job.
    const eventType = decision === "approved" ? "request_approved" : "request_rejected";
    const email = buildNotificationEmail({
      eventType,
      employeeName: row.employee_name,
      actorName,
      leaveTypeName: leaveType.name,
      startDate: row.start_date,
      endDate: row.end_date,
      days,
      note,
      isOverride,
    });

    await enqueueNotifications(tx, [
      {
        recipientId: row.user_id,
        actorId,
        leaveRequestId: requestId,
        eventType,
        subject: email.subject,
        body: email.body,
        htmlBody: email.html,
      },
    ]);

    return {
      request: {
        id: row.id,
        status: decision,
        decidedAt: decidedAt.toISOString(),
      },
      balance,
    };
  });
}

export async function decideLeaveRequest(
  input: DecideLeaveRequestInput,
): Promise<LeaveDecisionResult> {
  const note = input.reason?.trim() || null;

  if (input.decision === "rejected" && !note) {
    throw AppError.validation("A rejection reason is required.");
  }

  return applyDecision({
    requestId: input.requestId,
    actorId: input.managerId,
    actorName: input.managerName,
    decision: input.decision,
    note,
    isOverride: false,
    allowOverBalance: false,
    authorize: (row) => {
      if (row.manager_id !== input.managerId) {
        throw AppError.forbidden("You can only decide requests from your direct reports.");
      }
    },
  });
}

/**
 * HR cross-team override. This bypasses the direct-manager relationship and,
 * for approvals only, the over-balance guard (E2-11). The pending/duplicate
 * guards remain, and a reason is always required.
 */
export async function overrideLeaveRequest(
  input: OverrideLeaveRequestInput,
): Promise<LeaveDecisionResult> {
  const note = input.reason.trim();

  if (!note) {
    throw AppError.validation("An override reason is required.");
  }

  return applyDecision({
    requestId: input.requestId,
    actorId: input.actorId,
    actorName: input.actorName,
    decision: input.decision,
    note,
    isOverride: true,
    allowOverBalance: true,
    authorize: (row) => {
      if (row.user_id === input.actorId) {
        throw AppError.forbidden("You cannot override a decision on your own request.");
      }
    },
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
      select id, name, manager_id
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

    // The manager is notified here; with no manager the active HR admins are.
    // Both channels are enqueued inside this transaction, never sent from it.
    const recipients = await resolveSubmissionRecipients(tx, user.manager_id);
    const email = buildNotificationEmail({
      eventType: "request_submitted",
      employeeName: user.name,
      actorName: user.name,
      leaveTypeName: leaveType.name,
      startDate: input.startDate,
      endDate: input.endDate,
      days: requestedDays,
      reason: input.reason,
    });

    await enqueueNotifications(
      tx,
      recipients.map((recipientId) => ({
        recipientId,
        actorId: input.userId,
        leaveRequestId: inserted.id,
        eventType: "request_submitted" as const,
        subject: email.subject,
        body: email.body,
        htmlBody: email.html,
      })),
    );

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

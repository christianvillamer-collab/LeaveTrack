import "server-only";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { Role } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";

type Db = ReturnType<typeof getDb>;
import type {
  AuditDateRange,
  AuditEvent,
  AuditEventListOptions,
  AuditReport,
  AuditReportEmployee,
  AuditReportOptions,
  AuditReportRequest,
  LeaveType,
  Paginated,
  RequestStatus,
} from "@/lib/types";
import { formatRequestReference } from "@/lib/utils/format";
import { DEFAULT_PAGE_SIZE, toPaginationMeta } from "@/lib/validation/list";

interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface AuditRequestRow {
  id: string;
  reference: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  created_at: Date;
  decided_at: Date | null;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decided_by_email: string | null;
  leave_type_id: string;
  leave_type_name: string;
  tracks_balance: boolean;
}

interface AuditEventRow {
  total: number;
  id: string;
  request_id: string;
  request_reference: string;
  action: string;
  detail: string;
  occurred_at: Date;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
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

function toRequestStatus(status: string): RequestStatus {
  if (status === "pending" || status === "approved" || status === "rejected") {
    return status;
  }

  throw new AppError(ERROR_CODES.INTERNAL_ERROR, "A leave request has an unsupported status.", 500);
}

function toAuditAction(action: string): AuditEvent["action"] {
  if (
    action === "submitted" ||
    action === "approved" ||
    action === "rejected" ||
    action === "hr_override_approved" ||
    action === "hr_override_rejected"
  ) {
    return action;
  }

  throw new AppError(ERROR_CODES.INTERNAL_ERROR, "An audit record has an unsupported action.", 500);
}

function toEmployee(row: EmployeeRow): AuditReportEmployee {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

function toReportRequest(row: AuditRequestRow): AuditReportRequest {
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
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decidedBy:
      row.decided_by_id && row.decided_by_name
        ? { id: row.decided_by_id, name: row.decided_by_name, email: row.decided_by_email ?? "" }
        : null,
  };
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    requestId: row.request_id,
    requestReference: formatRequestReference(row.request_reference),
    employee: {
      id: row.employee_id,
      name: row.employee_name,
      email: row.employee_email,
    },
    actor: {
      id: row.actor_id,
      name: row.actor_name,
      email: row.actor_email,
    },
    action: toAuditAction(row.action),
    occurredAt: row.occurred_at.toISOString(),
    detail: row.detail,
  };
}

/**
 * Full audit report for one employee: request rows (AC1 fields) plus the
 * append-only audit timeline. Soft-deleted requests are excluded in SQL, but
 * the underlying rows are never purged (AC2). An optional date range filters
 * requests by `created_at` and events by `occurred_at` using inclusive UTC
 * calendar-day bounds; no upper retention cap is applied so old history stays
 * reportable.
 */
export async function getAuditReport(
  userId: string,
  options: AuditReportOptions = {},
): Promise<AuditReport | null> {
  const db = getDb();
  const from = options.from ?? null;
  const to = options.to ?? null;
  const status = options.status ?? null;
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const exportAll = options.exportAll ?? false;

  const [employees, requestRows, eventResult] = await Promise.all([
    db<EmployeeRow[]>`
      select id, name, email, role
      from users
      where id = ${userId}
      limit 1
    `,
    db<AuditRequestRow[]>`
      select
        r.id,
        r.reference,
        r.start_date::text as start_date,
        r.end_date::text as end_date,
        (r.end_date - r.start_date + 1)::int as days,
        r.status::text as status,
        r.created_at,
        r.decided_at,
        d.id as decided_by_id,
        d.name as decided_by_name,
        d.email as decided_by_email,
        lt.id as leave_type_id,
        lt.name as leave_type_name,
        lt.tracks_balance
      from leave_requests r
      join leave_types lt on lt.id = r.leave_type_id
      left join users d on d.id = r.decided_by
      where r.user_id = ${userId}
        and r.is_deleted = false
        and (${from}::date is null or r.created_at >= (${from}::date at time zone 'UTC'))
        and (${to}::date is null or r.created_at < ((${to}::date + 1) at time zone 'UTC'))
        and (${status}::request_status is null or r.status = ${status}::request_status)
      order by r.created_at desc, r.id desc
    `,
    listAuditEventsForEmployee(userId, {
      from: options.from,
      to: options.to,
      status: options.status,
      page,
      pageSize,
      exportAll,
    }),
  ]);

  const employee = employees[0];

  if (!employee) {
    return null;
  }

  return {
    employee: toEmployee(employee),
    requests: requestRows.map(toReportRequest),
    events: eventResult.items,
    pagination: eventResult.pagination,
    status: options.status,
    exportAll,
  };
}

interface AuditEventQueryOptions extends AuditDateRange {
  limit?: number | null;
  status?: RequestStatus;
  offset?: number | null;
}

/** One predicate shared by the page query and the empty-page total fallback. */
function auditEventFilter(db: Db, userId: string, options: AuditEventQueryOptions) {
  const from = options.from ?? null;
  const to = options.to ?? null;
  const status = options.status ?? null;

  return db`
    r.user_id = ${userId}
    and r.is_deleted = false
    and (${from}::date is null or a.occurred_at >= (${from}::date at time zone 'UTC'))
    and (${to}::date is null or a.occurred_at < ((${to}::date + 1) at time zone 'UTC'))
    and (${status}::request_status is null or r.status = ${status}::request_status)
  `;
}

async function queryAuditEventsForEmployee(
  userId: string,
  options: AuditEventQueryOptions,
): Promise<AuditEventRow[]> {
  const db = getDb();
  const filter = auditEventFilter(db, userId, options);

  return db<AuditEventRow[]>`
    select
      count(*) over ()::int as total,
      a.id,
      a.leave_request_id as request_id,
      r.reference as request_reference,
      a.action,
      coalesce(a.detail, '') as detail,
      a.occurred_at,
      e.id as employee_id,
      e.name as employee_name,
      e.email as employee_email,
      ac.id as actor_id,
      ac.name as actor_name,
      ac.email as actor_email
    from audit_log a
    join leave_requests r on r.id = a.leave_request_id
    join users e on e.id = r.user_id
    join users ac on ac.id = a.actor_id
    where ${filter}
    order by a.occurred_at desc, a.id desc
    limit ${options.limit ?? null}
    offset ${options.offset ?? null}
  `;
}

async function countAuditEventsForEmployee(
  userId: string,
  options: AuditEventQueryOptions,
): Promise<number> {
  const db = getDb();
  const [row] = await db<{ total: number }[]>`
    select count(*)::int as total
    from audit_log a
    join leave_requests r on r.id = a.leave_request_id
    where ${auditEventFilter(db, userId, options)}
  `;
  return row?.total ?? 0;
}

/**
 * Dashboard preview overload: a plain array bounded by `limit`.
 */
export async function listAuditEventsForEmployee(
  userId: string,
  limit?: number,
  dateRange?: AuditDateRange,
): Promise<AuditEvent[]>;
/**
 * Report overload: a page of events plus the total from the same SQL statement.
 * `exportAll` skips only the limit/offset so a CSV sees the whole filtered set.
 */
export async function listAuditEventsForEmployee(
  userId: string,
  options: AuditEventListOptions,
): Promise<Paginated<AuditEvent>>;
export async function listAuditEventsForEmployee(
  userId: string,
  limitOrOptions?: number | AuditEventListOptions,
  dateRange: AuditDateRange = {},
): Promise<AuditEvent[] | Paginated<AuditEvent>> {
  if (typeof limitOrOptions === "number" || limitOrOptions === undefined) {
    const rows = await queryAuditEventsForEmployee(userId, {
      limit: limitOrOptions,
      from: dateRange.from,
      to: dateRange.to,
    });
    return rows.map(toAuditEvent);
  }

  const options = limitOrOptions;
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const exportAll = options.exportAll ?? false;
  const queryOptions: AuditEventQueryOptions = {
    from: options.from,
    to: options.to,
    status: options.status,
    limit: exportAll ? null : pageSize,
    offset: exportAll ? null : (page - 1) * pageSize,
  };
  const rows = await queryAuditEventsForEmployee(userId, queryOptions);
  const total = rows[0]?.total ?? (await countAuditEventsForEmployee(userId, queryOptions));

  return {
    items: rows.map(toAuditEvent),
    pagination: exportAll
      ? toPaginationMeta(total, 1, Math.max(1, total))
      : toPaginationMeta(total, page, pageSize),
  };
}

/**
 * Org-wide audit volume and recent history for the HR dashboard. HR is the only
 * role that reads these; the policy gate lives on the page.
 */
export async function countAuditEvents(): Promise<number> {
  const rows = await getDb()<{ count: number }[]>`
    select count(*)::int as count
    from audit_log
  `;

  return Number(rows[0]?.count ?? 0);
}

export async function listRecentAuditEvents(limit: number): Promise<AuditEvent[]> {
  const rows = await getDb()<AuditEventRow[]>`
    select
      a.id,
      a.leave_request_id as request_id,
      r.reference as request_reference,
      a.action,
      coalesce(a.detail, '') as detail,
      a.occurred_at,
      e.id as employee_id,
      e.name as employee_name,
      e.email as employee_email,
      ac.id as actor_id,
      ac.name as actor_name,
      ac.email as actor_email
    from audit_log a
    join leave_requests r on r.id = a.leave_request_id
    join users e on e.id = r.user_id
    join users ac on ac.id = a.actor_id
    where r.is_deleted = false
    order by a.occurred_at desc
    limit ${limit}
  `;

  return rows.map(toAuditEvent);
}

/**
 * Chronological audit timeline for one active request. The request-detail page
 * shows oldest-first, unlike the org/employee reports.
 */
export async function listAuditEventsForRequest(requestId: string): Promise<AuditEvent[]> {
  const rows = await getDb()<AuditEventRow[]>`
    select
      a.id,
      a.leave_request_id as request_id,
      r.reference as request_reference,
      a.action,
      coalesce(a.detail, '') as detail,
      a.occurred_at,
      e.id as employee_id,
      e.name as employee_name,
      e.email as employee_email,
      ac.id as actor_id,
      ac.name as actor_name,
      ac.email as actor_email
    from audit_log a
    join leave_requests r on r.id = a.leave_request_id
    join users e on e.id = r.user_id
    join users ac on ac.id = a.actor_id
    where a.leave_request_id = ${requestId}
      and r.is_deleted = false
    order by a.occurred_at asc
  `;

  return rows.map(toAuditEvent);
}

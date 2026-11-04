import "server-only";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { Role } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import type {
  AuditEvent,
  AuditReport,
  AuditReportEmployee,
  AuditReportRequest,
  LeaveType,
  RequestStatus,
} from "@/lib/types";
import { formatRequestReference } from "@/lib/utils/format";

interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface AuditRequestRow {
  id: string;
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
  id: string;
  request_id: string;
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
  if (action === "submitted" || action === "approved" || action === "rejected") {
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
    reference: formatRequestReference(row.id),
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
    requestReference: formatRequestReference(row.request_id),
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
 * the underlying rows are never purged (AC2).
 */
export async function getAuditReport(userId: string): Promise<AuditReport | null> {
  const db = getDb();

  const [employees, requestRows, eventRows] = await Promise.all([
    db<EmployeeRow[]>`
      select id, name, email, role
      from users
      where id = ${userId}
      limit 1
    `,
    db<AuditRequestRow[]>`
      select
        r.id,
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
      order by r.created_at desc
    `,
    db<AuditEventRow[]>`
      select
        a.id,
        a.leave_request_id as request_id,
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
      where r.user_id = ${userId}
        and r.is_deleted = false
      order by a.occurred_at desc
    `,
  ]);

  const employee = employees[0];

  if (!employee) {
    return null;
  }

  return {
    employee: toEmployee(employee),
    requests: requestRows.map(toReportRequest),
    events: eventRows.map(toAuditEvent),
  };
}

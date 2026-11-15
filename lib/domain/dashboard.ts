import type {
  AccrualSummary,
  AuditEvent,
  LeaveBalance,
  MyLeaveData,
  MyLeaveRequest,
  OrgLeaveOverview,
  PolicyOverview,
  RequestStatus,
  RequestSummary,
  TeamLeaveData,
  TeamLeaveRequest,
  TeamMember,
} from "@/lib/types";

/**
 * Pure derivations for the dashboard. Every input comes from a database read;
 * this module performs no I/O and imports no fixtures, so the numbers can be
 * unit tested without a database or a browser.
 */

interface DatedRequest {
  startDate: string;
  endDate: string;
  status: RequestStatus;
}

/** Pending and approved leave from today onwards, soonest first. */
export function upcomingLeave<T extends DatedRequest>(requests: T[], today: string): T[] {
  return requests
    .filter((request) => request.startDate >= today && request.status !== "rejected")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function toRequestSummary(
  request: MyLeaveRequest,
  owner: { id: string; name: string },
): RequestSummary {
  return {
    id: request.id,
    reference: request.reference,
    employee: { id: owner.id, name: owner.name },
    leaveType: request.leaveType,
    startDate: request.startDate,
    endDate: request.endDate,
    days: request.days,
    status: request.status,
    createdAt: request.createdAt,
  };
}

export interface EmployeeLeaveSummary {
  requests: RequestSummary[];
  pendingCount: number;
  approvedDays: number;
  upcoming: MyLeaveRequest[];
  nextLeave: MyLeaveRequest | null;
  vacationBalance: LeaveBalance | null;
}

export function summariseEmployeeLeave(
  owner: { id: string; name: string },
  data: MyLeaveData,
  today: string,
): EmployeeLeaveSummary {
  const requests = data.requests.map((request) => toRequestSummary(request, owner));
  const approvedDays = data.requests
    .filter((request) => request.status === "approved")
    .reduce((total, request) => total + request.days, 0);
  const upcoming = upcomingLeave(data.requests, today);

  return {
    requests,
    pendingCount: data.requests.filter((request) => request.status === "pending").length,
    approvedDays,
    upcoming,
    nextLeave: upcoming[0] ?? null,
    vacationBalance: data.balances.find((balance) => balance.leaveType.name === "Vacation") ?? null,
  };
}

export interface ManagerQueueSummary {
  pending: TeamLeaveRequest[];
  pendingCount: number;
  decided: TeamLeaveRequest[];
  currentlyAway: TeamLeaveRequest[];
  reports: TeamMember[];
}

/**
 * The manager preview is the scoped team response, already filtered to direct
 * reports in SQL. Nothing here widens or re-filters by manager.
 */
export function summariseManagerQueue(data: TeamLeaveData): ManagerQueueSummary {
  const pending = data.requests.filter((request) => request.status === "pending");

  return {
    pending,
    pendingCount: pending.length,
    decided: data.requests.filter((request) => request.status !== "pending"),
    currentlyAway: data.requests.filter((request) => request.status === "approved").slice(0, 3),
    reports: data.directReports,
  };
}

export interface OrgDashboardSummary {
  pending: RequestSummary[];
  pendingCount: number;
  headcount: number;
  events: AuditEvent[];
  eventCount: number;
  policies: PolicyOverview[];
  accrual: AccrualSummary;
}

export interface OrgDashboardInput {
  overview: OrgLeaveOverview;
  events: AuditEvent[];
  eventCount: number;
  policies: PolicyOverview[];
  accrual: AccrualSummary;
}

export function summariseOrg(input: OrgDashboardInput): OrgDashboardSummary {
  const pending = input.overview.requests.filter((request) => request.status === "pending");

  return {
    pending,
    pendingCount: pending.length,
    headcount: input.overview.headcount,
    events: input.events,
    eventCount: input.eventCount,
    policies: input.policies,
    accrual: input.accrual,
  };
}

/** Today in the same `YYYY-MM-DD` shape the database returns for date columns. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

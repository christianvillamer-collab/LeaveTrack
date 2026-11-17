import type { Role } from "@/lib/auth/roles";

export type RequestStatus = "pending" | "approved" | "rejected";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  jobTitle: string;
  team: string;
}

export interface LeaveType {
  id: string;
  name: "Vacation" | "Sick" | "Unpaid";
  tracksBalance: boolean;
}

export interface LeaveRequest {
  id: string;
  reference: string;
  employee: Employee;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: RequestStatus;
  decidedBy: Employee | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/**
 * The fields a request table renders. `LeaveRequest` is structurally assignable
 * to this shape, so fixture-backed screens keep working while DB-backed lists
 * omit presentation-only fields (`jobTitle`, `team`) that have no column.
 */
export interface RequestSummaryEmployee {
  id: string;
  name: string;
  email?: string;
  jobTitle?: string;
}

export interface RequestSummary {
  id: string;
  reference: string;
  employee: RequestSummaryEmployee;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: RequestStatus;
  createdAt: string;
}

/** Full DB-backed record for the request detail page. */
export interface LeaveRequestDetail {
  id: string;
  reference: string;
  employee: {
    id: string;
    name: string;
    email: string;
    managerId: string | null;
    managerName: string | null;
  };
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: RequestStatus;
  decidedBy: AuditEventPerson | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface LeaveBalance {
  leaveType: LeaveType;
  confirmed: number | null;
  pending: number;
  accrualPerMonth: number | null;
  /** Latest `accrual_ledger.created_at` for this leave type; null means no accrual has ever run. */
  lastAccruedAt: string | null;
}

export interface Policy {
  id: string;
  leaveType: LeaveType;
  accrualPerMonth: number;
  assignedEmployees: number;
}

/** One effective-dated rate: the rate for a month and every month after it. */
export interface PolicyRate {
  userId: string;
  leaveTypeId: string;
  accrualPerMonth: number;
  effectiveFrom: string;
}

/** Result of an HR policy upsert; `auditWritten` is false for a no-op save. */
export interface PolicyRateResult extends PolicyRate {
  previousRate: number | null;
  auditWritten: boolean;
}

/**
 * Identity columns the database actually stores for a user. `Employee` carries
 * presentation-only fields (job title, team) that have no column yet, so audit
 * surfaces use this narrower shape.
 */
export type AuditEventPerson = Pick<Employee, "id" | "name" | "email">;

export interface AuditEvent {
  id: string;
  requestId: string;
  requestReference: string;
  employee: AuditEventPerson;
  actor: AuditEventPerson;
  action: "submitted" | "approved" | "rejected";
  occurredAt: string;
  detail: string;
}

export interface AuditReportRequest {
  id: string;
  reference: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: AuditEventPerson | null;
}

/** One append-only row of `policy_audit_log`, joined for display. */
export interface PolicyChange {
  id: string;
  employee: AuditEventPerson;
  leaveType: LeaveType;
  effectiveFrom: string;
  previousRate: number | null;
  newRate: number;
  actor: AuditEventPerson;
  changedAt: string;
}

export interface AuditReportEmployee extends AuditEventPerson {
  role: Role;
}

export interface AuditReport {
  employee: AuditReportEmployee;
  requests: AuditReportRequest[];
  events: AuditEvent[];
}

export interface LeaveRequestWarning {
  exceedsBalance: boolean;
  requestedDays: number;
  availableDays: number | null;
  message: string | null;
}

export interface CreatedLeaveRequest {
  id: string;
  status: "pending";
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  createdAt: string;
}

export interface CreateLeaveRequestResult {
  request: CreatedLeaveRequest;
  warning: LeaveRequestWarning;
  managerNotified: boolean;
}

export interface MyLeaveRequest {
  id: string;
  reference: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: RequestStatus;
  createdAt: string;
}

export interface MyLeaveData {
  balances: LeaveBalance[];
  requests: MyLeaveRequest[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
}

export interface TeamLeaveRequest {
  id: string;
  reference: string;
  employee: TeamMember;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: RequestStatus;
  createdAt: string;
}

export interface TeamLeaveData {
  requests: TeamLeaveRequest[];
  directReports: TeamMember[];
}

export interface LeaveDecisionResult {
  request: {
    id: string;
    status: "approved" | "rejected";
    decidedAt: string;
  };
  balance: {
    leaveTypeId: string;
    leaveTypeName: LeaveType["name"];
    previous: number;
    next: number;
  } | null;
}

export interface AccrualResult {
  period: string;
  usersAccrued: number;
  balancesAccrued: number;
  totalDays: number;
}

/**
 * Org-level accrual status read from `accrual_ledger`. A never-run accrual is
 * all-null rather than a fabricated date (ADR-E002: the ledger is the marker,
 * never `leave_balances.updated_at`).
 */
export interface AccrualSummary {
  lastPeriod: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  peopleProcessed: number;
}

/** One row of the HR policy snapshot, grouped from `leave_policies`. */
export interface PolicyOverview {
  leaveType: LeaveType;
  accrualPerMonth: number;
  assignedEmployees: number;
}

/** Directory row with the manager name resolved by a self join. */
export interface DirectoryEntry {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  managerName: string | null;
}

/** Who changed a people record and what kind of change it was. */
export type UserAuditAction =
  "profile_updated" | "manager_reassigned" | "deactivated" | "reactivated" | "imported";

/**
 * The HR people-admin row. Wider than `DirectoryEntry` (which backs the
 * dashboard and policy pages) because people admin also needs the directory
 * fields, deactivation state, and whether a sign-in identity is linked.
 */
export interface PersonDirectoryEntry {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  managerName: string | null;
  jobTitle: string | null;
  team: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  authSubjectLinked: boolean;
}

export interface PersonAuditEntry {
  id: string;
  action: UserAuditAction;
  detail: string | null;
  actorName: string;
  subjectName: string;
  createdAt: string;
}

/** Org-wide request list plus headcount, the two inputs HR totals need. */
export interface OrgLeaveOverview {
  requests: RequestSummary[];
  headcount: number;
}

/** Who an event is addressed to and how it is delivered. */
export type NotificationEventType = "request_submitted" | "request_approved" | "request_rejected";

export type NotificationChannel = "in_app" | "email";

export type NotificationStatus = "pending" | "sent" | "failed" | "skipped";

/** One row of the recipient's in-app notification list. */
export interface NotificationItem {
  id: string;
  eventType: NotificationEventType;
  subject: string;
  body: string;
  leaveRequestId: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationItem[];
  unreadCount: number;
}

/** Outcome of one delivery attempt batch from the notification cron job. */
export interface NotificationJobResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

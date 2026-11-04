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

export interface LeaveBalance {
  leaveType: LeaveType;
  confirmed: number | null;
  pending: number;
  accrualPerMonth: number | null;
  lastAccruedAt: string;
}

export interface Policy {
  id: string;
  leaveType: LeaveType;
  accrualPerMonth: number;
  assignedEmployees: number;
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

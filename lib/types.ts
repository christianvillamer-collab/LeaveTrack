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

export interface AuditEvent {
  id: string;
  requestId: string;
  requestReference: string;
  employee: Employee;
  actor: Employee;
  action: "submitted" | "approved" | "rejected";
  occurredAt: string;
  detail: string;
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

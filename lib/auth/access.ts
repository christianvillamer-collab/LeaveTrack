import type { Session } from "@/lib/auth/session";
import { currentEmployee } from "@/lib/mock/data";
import type { Employee, LeaveRequest } from "@/lib/types";

export function viewerFor(session: Session): Employee {
  return currentEmployee(session.role);
}

/**
 * Mirrors the Day 1 server-side scoping rule: employees see their own
 * requests, managers see direct reports only, HR admins see everything.
 * This is presentation guarding for Day 0; the SQL filter is still required.
 */
export function canViewRequest(session: Session, request: LeaveRequest): boolean {
  if (session.role === "hr_admin") {
    return true;
  }

  const viewer = viewerFor(session);

  if (session.role === "employee") {
    return request.employee.id === viewer.id;
  }

  return request.employee.managerId === viewer.id || request.employee.id === viewer.id;
}

export function canDecideRequest(session: Session, request: LeaveRequest): boolean {
  if (request.status !== "pending") {
    return false;
  }

  if (session.role === "hr_admin") {
    return true;
  }

  if (session.role !== "manager") {
    return false;
  }

  return request.employee.managerId === viewerFor(session).id;
}

import type { Role } from "@/lib/auth/roles";
import type { RequestStatus } from "@/lib/types";

/**
 * Central authorization policy (ADR-E004). Roles gate the *kind* of action;
 * relationships gate *which records*. This module is pure: it reads no cookies,
 * no provider claims, and no mock fixtures, so the same checks run in pages and
 * route handlers. The DB `users.role` remains the only role source.
 */

export interface Actor {
  id: string;
  role: Role;
}

export interface RequestScope {
  ownerId: string;
  ownerManagerId: string | null;
  status: RequestStatus;
}

/** Role-only gates accept a full `Actor` (e.g. `Session`) or a bare `Role`. */
type Subject = Actor | Role;

function roleOf(subject: Subject): Role {
  return typeof subject === "string" ? subject : subject.role;
}

function isSelf(actor: Actor, ownerId: string): boolean {
  return actor.id === ownerId;
}

function isDirectReport(actor: Actor, ownerManagerId: string | null): boolean {
  return actor.role === "manager" && ownerManagerId !== null && ownerManagerId === actor.id;
}

/** Own records for everyone; direct reports for managers; everything for HR. */
export function canViewRequest(actor: Actor, scope: RequestScope): boolean {
  if (actor.role === "hr_admin") {
    return true;
  }

  if (isSelf(actor, scope.ownerId)) {
    return true;
  }

  return isDirectReport(actor, scope.ownerManagerId);
}

/**
 * Only a pending request can be decided. Managers may decide their direct
 * reports' requests; HR sees the decision surface but the audited override path
 * remains a separate task, as does the transactional `manager_id` SQL check.
 */
export function canDecideRequest(actor: Actor, scope: RequestScope): boolean {
  if (scope.status !== "pending") {
    return false;
  }

  if (actor.role === "hr_admin") {
    return true;
  }

  return isDirectReport(actor, scope.ownerManagerId);
}

/** `scope=team` is manager-only; HR uses the explicit override boundary. */
export function canViewTeam(subject: Subject): boolean {
  return roleOf(subject) === "manager";
}

/**
 * Manager-only gate for the decision endpoint. The record-level check (the
 * owner's `manager_id`) stays in the transactional SQL.
 */
export function canDecideTeamRequests(subject: Subject): boolean {
  return roleOf(subject) === "manager";
}

export function canManageRequests(subject: Subject): boolean {
  const role = roleOf(subject);
  return role === "manager" || role === "hr_admin";
}

export function canRunAudit(subject: Subject): boolean {
  return roleOf(subject) === "hr_admin";
}

export function canConfigurePolicies(subject: Subject): boolean {
  return roleOf(subject) === "hr_admin";
}

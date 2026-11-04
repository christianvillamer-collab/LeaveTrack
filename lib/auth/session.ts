import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  canConfigurePolicies,
  canManageRequests,
  canRunAudit,
  isRole,
  type Role,
} from "@/lib/auth/roles";

export const SESSION_COOKIE = "mock-role";
export const SESSION_NAME_COOKIE = "mock-user";
export const SESSION_EMAIL_COOKIE = "mock-email";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export interface Session {
  role: Role;
  name: string;
  email: string;
}

const FALLBACK_NAMES: Record<Role, string> = {
  employee: "Maya Chen",
  manager: "Daniel Okafor",
  hr_admin: "Priya Nair",
};

const FALLBACK_EMAILS: Record<Role, string> = {
  employee: "maya.chen@leavetrack.demo",
  manager: "daniel.okafor@leavetrack.demo",
  hr_admin: "priya.nair@leavetrack.demo",
};

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const role = store.get(SESSION_COOKIE)?.value;

  if (!isRole(role)) {
    return null;
  }

  return {
    role,
    name: store.get(SESSION_NAME_COOKIE)?.value || FALLBACK_NAMES[role],
    email: store.get(SESSION_EMAIL_COOKIE)?.value || FALLBACK_EMAILS[role],
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireRole(allowed: readonly Role[]): Promise<Session> {
  const session = await requireSession();

  if (!allowed.includes(session.role)) {
    redirect("/forbidden");
  }

  return session;
}

export function canAccessPath(role: Role, pathname: string): boolean {
  if (pathname.startsWith("/approvals")) {
    return canManageRequests(role);
  }

  if (pathname.startsWith("/audit")) {
    return canRunAudit(role);
  }

  if (pathname.startsWith("/settings")) {
    return canConfigurePolicies(role);
  }

  return true;
}

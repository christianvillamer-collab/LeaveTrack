import { cache } from "react";
import { redirect } from "next/navigation";

import { canConfigurePolicies, canManageRequests, canRunAudit, type Role } from "@/lib/auth/roles";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase";
import { findUserByEmail } from "@/lib/db/users";

export interface Session {
  role: Role;
  name: string;
  email: string;
}

/**
 * Verifies the provider session, then maps the verified email to exactly one
 * `users` row. The provider proves *who* the user is; the DB row supplies the
 * role (ADR-E004). Unconfirmed or unlinked identities are treated as
 * unauthenticated.
 */
async function loadSession(): Promise<Session | null> {
  if (!isAuthConfigured()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const email = data.user.email?.trim();

  if (!email || !data.user.email_confirmed_at) {
    return null;
  }

  const user = await findUserByEmail(email);

  if (!user) {
    return null;
  }

  return { role: user.role, name: user.name, email: user.email };
}

/**
 * Cached per request so the `(app)` layout and the page it renders resolve the
 * session once, not once per component.
 */
export const getSession = cache(loadSession);

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

  if (pathname.startsWith("/audit") || pathname.startsWith("/api/audit")) {
    return canRunAudit(role);
  }

  if (pathname.startsWith("/settings")) {
    return canConfigurePolicies(role);
  }

  return true;
}

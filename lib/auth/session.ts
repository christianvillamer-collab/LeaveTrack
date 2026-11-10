import { cache } from "react";
import { redirect } from "next/navigation";

import type { Role } from "@/lib/auth/roles";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase";
import { findUserByEmail } from "@/lib/db/users";

export interface Session {
  id: string;
  role: Role;
  name: string;
  email: string;
  managerId: string | null;
}

/**
 * Verifies the provider session, then maps the verified email to exactly one
 * `users` row. The provider proves *who* the user is; the DB row supplies the
 * id and role (ADR-E004). Unconfirmed or unlinked identities are treated as
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

  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    managerId: user.managerId,
  };
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

/**
 * Page-level authorization gate. The predicate comes from `lib/auth/policy.ts`,
 * so every page and route check runs through the same matrix.
 */
export async function requirePolicy(check: (session: Session) => boolean): Promise<Session> {
  const session = await requireSession();

  if (!check(session)) {
    redirect("/forbidden");
  }

  return session;
}

export async function requireRole(allowed: readonly Role[]): Promise<Session> {
  return requirePolicy((session) => allowed.includes(session.role));
}

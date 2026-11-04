"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ROLE_HOME, ROLE_LABELS, ROLES, type Role } from "@/lib/auth/roles";
import {
  SESSION_COOKIE,
  SESSION_EMAIL_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  SESSION_NAME_COOKIE,
} from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter a password."),
  role: z.enum(ROLES),
  next: z.string().optional(),
});

export interface LoginState {
  error: string | null;
}

function displayNameFromEmail(email: string, role: Role): string {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart
    .split(/[._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return words.length > 0 ? words.join(" ") : ROLE_LABELS[role];
}

function safeNextPath(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next === "/login") {
    return null;
  }

  return next;
}

/**
 * Day 0 mock login. No credentials are checked and no provider is called.
 * The cookie is replaced by the real provider's session in Day 1; the guard
 * and server-component session read stay the same.
 */
export async function mockLogin(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { email, role, next } = parsed.data;
  const store = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };

  store.set(SESSION_COOKIE, role, options);
  store.set(SESSION_NAME_COOKIE, displayNameFromEmail(email, role), options);
  store.set(SESSION_EMAIL_COOKIE, email, options);

  redirect(safeNextPath(next) ?? ROLE_HOME);
}

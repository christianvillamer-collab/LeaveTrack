"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { ROLE_HOME } from "@/lib/auth/roles";
import {
  AuthConfigurationError,
  createSupabaseServerClient,
  isAuthConfigured,
} from "@/lib/auth/supabase";
import { findUserByEmail, type DbUser } from "@/lib/db/users";
import { logger } from "@/lib/logging/logger";

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter a password."),
  next: z.string().optional(),
});

export interface LoginState {
  error: string | null;
}

const CONFIG_ERROR = "Sign-in is not configured. Contact an administrator.";
const CREDENTIALS_ERROR = "Email or password is incorrect.";
const UNCONFIRMED_ERROR =
  "Confirm your email address before signing in. Check your inbox for the link.";
const UNLINKED_ERROR = "No employee record is linked to this account. Contact HR.";
const UNAVAILABLE_ERROR = "We could not complete sign-in. Try again in a moment.";

function safeNextPath(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next === "/login") {
    return null;
  }

  return next;
}

/**
 * Real sign-in. Supabase Auth checks the credentials; the verified email is then
 * mapped to exactly one `users` row, and that row's role decides where the
 * user lands. An authenticated identity with no employee record is signed out
 * rather than allowed into the app.
 */
export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  if (!isAuthConfigured()) {
    return { error: CONFIG_ERROR };
  }

  const { email, password, next } = parsed.data;

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;

  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return { error: CONFIG_ERROR };
    }

    throw error;
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signInData.user) {
    return { error: CREDENTIALS_ERROR };
  }

  // A project can allow sign-in before the address is confirmed. Such an
  // identity has no verified email, so it must not reach the app.
  if (!signInData.user.email_confirmed_at) {
    await supabase.auth.signOut().catch(() => undefined);
    return { error: UNCONFIRMED_ERROR };
  }

  let user: DbUser | null;

  try {
    user = await findUserByEmail(email);
  } catch (error) {
    logger.error({ err: error }, "auth.identity_lookup_failed");
    await supabase.auth.signOut().catch(() => undefined);
    return { error: UNAVAILABLE_ERROR };
  }

  if (!user) {
    await supabase.auth.signOut().catch(() => undefined);
    return { error: UNLINKED_ERROR };
  }

  redirect(safeNextPath(next) ?? ROLE_HOME);
}

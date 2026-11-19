import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ROLE_HOME } from "@/lib/auth/roles";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import {
  AuthConfigurationError,
  createSupabaseRouteClient,
  isAuthConfigured,
} from "@/lib/auth/supabase";
import { linkAuthSubject, resolveUserForIdentity } from "@/lib/db/users";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter a password."),
  next: z.string().optional(),
});

type ErrorCode = "config" | "auth" | "unconfirmed" | "unlinked" | "deactivated" | "unavailable";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  config: "Sign-in is not configured. Contact an administrator.",
  auth: "Email or password is incorrect.",
  unconfirmed: "Confirm your email address before signing in. Check your inbox for the link.",
  unlinked: "No employee record is linked to this account. Contact HR.",
  deactivated: "This account has been deactivated. Contact HR.",
  unavailable: "We could not complete sign-in. Try again in a moment.",
};

const ERROR_STATUS: Record<ErrorCode, number> = {
  config: 503,
  auth: 401,
  unconfirmed: 403,
  unlinked: 403,
  deactivated: 403,
  unavailable: 503,
};

function noStore(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  return headers;
}

function wantsJson(request: NextRequest): boolean {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

function baseUrlFor(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;
}

function failure(request: NextRequest, code: ErrorCode, message?: string) {
  const text = message ?? ERROR_MESSAGES[code];

  if (wantsJson(request)) {
    return NextResponse.json({ error: text }, { status: ERROR_STATUS[code], headers: noStore() });
  }

  const url = new URL("/login", baseUrlFor(request));
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, { status: 303, headers: noStore() });
}

async function readCredentials(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body: unknown = await request.json().catch(() => null);
    return loginSchema.safeParse(body ?? {});
  }

  const form = await request.formData().catch(() => null);

  return loginSchema.safeParse({
    email: form?.get("email"),
    password: form?.get("password"),
    next: form?.get("next") ?? undefined,
  });
}

/**
 * Password sign-in for both hydrated and no-JS forms. Supabase cookies are
 * written onto this Route Handler's Response, so Next never re-renders `/login`
 * inside the POST and never streams the protected destination through it. The
 * hydrated client gets JSON and drives a top-level navigation; a plain form
 * submission gets a normal 303 redirect.
 */
export async function POST(request: NextRequest) {
  const parsed = await readCredentials(request);

  if (!parsed.success) {
    return failure(request, "auth", parsed.error.issues[0]?.message ?? ERROR_MESSAGES.auth);
  }

  if (!isAuthConfigured()) {
    return failure(request, "config");
  }

  const { email, password, next } = parsed.data;
  let auth: ReturnType<typeof createSupabaseRouteClient>;

  try {
    auth = createSupabaseRouteClient(request);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return failure(request, "config");
    }

    throw error;
  }

  const { supabase, applyTo } = auth;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return applyTo(failure(request, "auth"));
  }

  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut().catch(() => undefined);
    return applyTo(failure(request, "unconfirmed"));
  }

  const verifiedEmail = data.user.email?.trim();

  if (!verifiedEmail) {
    await supabase.auth.signOut().catch(() => undefined);
    return applyTo(failure(request, "auth"));
  }

  let identity: Awaited<ReturnType<typeof resolveUserForIdentity>>;

  try {
    identity = await resolveUserForIdentity({
      subject: data.user.id ?? null,
      email: verifiedEmail,
    });
  } catch (error) {
    logger.error({ err: error }, "auth.identity_lookup_failed");
    await supabase.auth.signOut().catch(() => undefined);
    return applyTo(failure(request, "unavailable"));
  }

  if (!identity) {
    await supabase.auth.signOut().catch(() => undefined);
    return applyTo(failure(request, "unlinked"));
  }

  if (!identity.user.isActive) {
    await supabase.auth.signOut().catch(() => undefined);
    return applyTo(failure(request, "deactivated"));
  }

  if (identity.needsSubjectLink && data.user.id) {
    try {
      await linkAuthSubject(identity.user.id, data.user.id);
    } catch (error) {
      logger.warn({ err: error }, "auth.subject_link_failed");
    }
  }

  const destination = safeNextPath(next) ?? ROLE_HOME;
  const response = wantsJson(request)
    ? NextResponse.json({ redirectTo: destination }, { headers: noStore() })
    : NextResponse.redirect(new URL(destination, baseUrlFor(request)), {
        status: 303,
        headers: noStore(),
      });

  return applyTo(response);
}

import { NextResponse, type NextRequest } from "next/server";

import { ROLE_HOME } from "@/lib/auth/roles";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase";
import { linkAuthSubject, resolveUserForIdentity } from "@/lib/db/users";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

function baseUrlFor(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;
}

/**
 * Completes magic-link, OAuth, and email-confirmation redirects. The provider
 * code is exchanged for a cookie session, then the verified email must map to
 * a `users` row before the user is allowed in.
 */
export async function GET(request: NextRequest) {
  const baseUrl = baseUrlFor(request);
  const loginUrl = new URL("/login", baseUrl);

  if (!isAuthConfigured()) {
    loginUrl.searchParams.set("error", "config");
    return NextResponse.redirect(loginUrl);
  }

  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    loginUrl.searchParams.set("error", "auth");
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.warn({ err: error }, "auth.callback_exchange_failed");
    loginUrl.searchParams.set("error", "auth");
    return NextResponse.redirect(loginUrl);
  }

  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim();

  if (!email || !data.user?.email_confirmed_at) {
    await supabase.auth.signOut().catch(() => undefined);
    loginUrl.searchParams.set("error", "unconfirmed");
    return NextResponse.redirect(loginUrl);
  }

  let identity: Awaited<ReturnType<typeof resolveUserForIdentity>>;

  try {
    identity = await resolveUserForIdentity({
      subject: data.user?.id ?? null,
      email,
    });
  } catch (error) {
    logger.error({ err: error }, "auth.callback_identity_lookup_failed");
    await supabase.auth.signOut().catch(() => undefined);
    loginUrl.searchParams.set("error", "unavailable");
    return NextResponse.redirect(loginUrl);
  }

  if (!identity) {
    await supabase.auth.signOut().catch(() => undefined);
    // `/forbidden` requires a session, so a signed-out identity there would
    // bounce to `/login` with no explanation. Surface the reason instead.
    loginUrl.searchParams.set("error", "unlinked");
    return NextResponse.redirect(loginUrl);
  }

  if (!identity.user.isActive) {
    await supabase.auth.signOut().catch(() => undefined);
    loginUrl.searchParams.set("error", "deactivated");
    return NextResponse.redirect(loginUrl);
  }

  if (identity.needsSubjectLink && data.user?.id) {
    try {
      await linkAuthSubject(identity.user.id, data.user.id);
    } catch (error) {
      logger.warn({ err: error }, "auth.subject_link_failed");
    }
  }

  const destination = safeNextPath(request.nextUrl.searchParams.get("next")) ?? ROLE_HOME;

  return NextResponse.redirect(new URL(destination, baseUrl));
}

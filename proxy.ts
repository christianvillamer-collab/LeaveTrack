import { NextResponse, type NextRequest } from "next/server";

import { ERROR_CODES, errorEnvelope } from "@/lib/api/errors";
import { createSupabaseProxyClient, isAuthConfigured } from "@/lib/auth/supabase";

// `/api/jobs/accrual` is the system cron route: it has no user session and
// authenticates itself with CRON_SECRET, so it must never pay for a refresh.
// The `PUBLIC_AUTH_PATHS` routes can still carry a session, so the proxy
// refreshes them: their pages read the session in a Server Component, where a
// cookie write is swallowed, and a lost refresh-token rotation can revoke it.
const PUBLIC_AUTH_PATHS = new Set(["/login", "/auth/callback", "/forbidden"]);
const PUBLIC_SYSTEM_PATHS = new Set(["/api/health", "/api/jobs/accrual"]);
const ASSET_PATTERN = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?)$/i;

function isAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/") || ASSET_PATTERN.test(pathname);
}

function isPublicAuth(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.has(pathname);
}

function noStore(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  return result;
}

function apiError(
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message: string,
  status: number,
) {
  return NextResponse.json(errorEnvelope(code, message), {
    status,
    headers: noStore(),
  });
}

type ClaimsResult = {
  data: { claims: { sub?: string } } | null;
  error: unknown;
};

/**
 * Authentication gate only. Authorization (role and relationship scoping) stays
 * in the pages, route handlers, and the DB — E2-03 centralizes it. The proxy
 * must not trust provider claims for roles (ADR-E004).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Assets and system routes never read a user session.
  if (isAsset(pathname) || PUBLIC_SYSTEM_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthConfigured()) {
    if (isPublicAuth(pathname)) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
      return apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Authentication is not configured.", 503);
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  let client: ReturnType<typeof createSupabaseProxyClient> | null = null;
  let claims: ClaimsResult | null = null;

  try {
    client = createSupabaseProxyClient(request);
    claims = (await client.supabase.auth.getClaims()) as ClaimsResult;
  } catch {
    // A malformed URL or an unreachable auth server must fail closed rather
    // than surface a 500 on every route.
    claims = null;
  }

  // `getClaims()` verifies asymmetric JWTs locally and falls back to the auth
  // server for symmetric projects, so a missing `sub` means no valid session.
  if (client && claims?.data?.claims.sub && !claims.error) {
    return client.response();
  }

  // Public auth pages still need the refreshed-cookie response when a session
  // exists, but they must remain reachable without one.
  if (isPublicAuth(pathname)) {
    return client?.response() ?? NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return apiError(ERROR_CODES.UNAUTHENTICATED, "Authentication is required.", 401);
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

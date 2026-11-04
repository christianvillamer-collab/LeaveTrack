import { NextResponse, type NextRequest } from "next/server";

import { errorEnvelope } from "@/lib/api/errors";
import { canViewRequest } from "@/lib/auth/access";
import { canAccessPath } from "@/lib/auth/session";
import { ROLE_HOME, isRole } from "@/lib/auth/roles";
import { requestById } from "@/lib/mock/data";

// `/api/jobs/accrual` is the system cron route: it has no user session and
// authenticates itself with CRON_SECRET, so it must bypass the mock cookie gate.
const PUBLIC_PATHS = new Set(["/login", "/api/health", "/api/jobs/accrual", "/forbidden"]);
const ASSET_PATTERN = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?)$/i;

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/") || ASSET_PATTERN.test(pathname)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = request.cookies.get("mock-role")?.value;

  if (isPublic(pathname)) {
    if (pathname === "/login" && isRole(role)) {
      return NextResponse.redirect(new URL(ROLE_HOME, request.url));
    }

    return NextResponse.next();
  }

  if (!isRole(role)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(errorEnvelope("UNAUTHENTICATED", "Authentication is required."), {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (!canAccessPath(role, pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        errorEnvelope("FORBIDDEN", "You do not have access to this resource."),
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  // Day 0 only: record-level guard so a forbidden request returns 307 before
  // streaming starts. Day 1 replaces this fixture lookup with the scoped SQL
  // query; the page-level check in lib/auth/access.ts stays as defense in depth.
  const detailMatch = /^\/requests\/([^/]+)$/.exec(pathname);
  if (detailMatch) {
    const record = requestById(decodeURIComponent(detailMatch[1]));

    if (record && !canViewRequest({ role, name: "", email: "" }, record)) {
      return NextResponse.redirect(new URL("/forbidden", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

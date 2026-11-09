import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  configured: true,
  claimsSub: null as string | null,
  claimsError: null as null | { name: string; message: string },
  clientThrows: false,
  proxyResponse: null as unknown,
}));

vi.mock("@/lib/auth/supabase", async () => {
  const { NextResponse: Response } = await import("next/server");

  return {
    isAuthConfigured: () => state.configured,
    createSupabaseProxyClient: () => {
      if (state.clientThrows) {
        throw new Error("Invalid Supabase URL");
      }

      return {
        supabase: {
          auth: {
            getClaims: async () => {
              if (state.claimsError) {
                return { data: null, error: state.claimsError };
              }

              if (state.claimsSub) {
                return { data: { claims: { sub: state.claimsSub } }, error: null };
              }

              return {
                data: null,
                error: {
                  name: "AuthSessionMissingError",
                  message: "Auth session missing!",
                },
              };
            },
          },
        },
        response: () => state.proxyResponse ?? Response.next(),
      };
    },
  };
});

import { proxy } from "@/proxy";

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

beforeEach(() => {
  state.configured = true;
  state.claimsSub = null;
  state.claimsError = null;
  state.clientThrows = false;
  state.proxyResponse = null;
});

describe("proxy authentication gate", () => {
  it("passes public paths without checking auth", async () => {
    state.configured = false;

    await expect(proxy(request("/api/health"))).resolves.toMatchObject({ status: 200 });
    await expect(proxy(request("/login"))).resolves.toMatchObject({ status: 200 });
    await expect(proxy(request("/auth/callback?code=abc"))).resolves.toMatchObject({
      status: 200,
    });
  });

  it("returns the 401 envelope for an unauthenticated API request", async () => {
    const response = await proxy(request("/api/leave-requests"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
    });
  });

  it("redirects an unauthenticated page to /login with the original destination", async () => {
    const response = await proxy(request("/requests?status=pending"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/requests?status=pending");
  });

  it("returns 503 for a protected API when auth is not configured", async () => {
    state.configured = false;

    const response = await proxy(request("/api/leave-requests"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Authentication is not configured.",
      },
    });
  });

  it("redirects a protected page to /login when auth is not configured", async () => {
    state.configured = false;

    const response = await proxy(request("/dashboard"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("returns the refreshed response for an authenticated request", async () => {
    state.claimsSub = "00000000-0000-0000-0000-000000000001";
    const refreshed = NextResponse.next();
    state.proxyResponse = refreshed;

    await expect(proxy(request("/dashboard"))).resolves.toBe(refreshed);
  });

  it("treats a claims payload without a subject as unauthenticated", async () => {
    state.claimsSub = "";

    const response = await proxy(request("/dashboard"));

    expect(response.status).toBe(307);
  });

  it("treats a provider error as unauthenticated even with claims data", async () => {
    state.claimsSub = "00000000-0000-0000-0000-000000000001";
    state.claimsError = { name: "AuthError", message: "invalid signature" };

    const response = await proxy(request("/api/audit/user-1"));

    expect(response.status).toBe(401);
  });

  it("fails closed when the provider client cannot be constructed", async () => {
    state.clientThrows = true;

    const apiResponse = await proxy(request("/api/leave-requests"));
    expect(apiResponse.status).toBe(401);

    const pageResponse = await proxy(request("/dashboard"));
    expect(pageResponse.status).toBe(307);
    expect(new URL(pageResponse.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("refreshes the session on a public auth page instead of skipping it", async () => {
    state.claimsSub = "00000000-0000-0000-0000-000000000001";
    const refreshed = NextResponse.next();
    state.proxyResponse = refreshed;

    await expect(proxy(request("/login"))).resolves.toBe(refreshed);
  });

  it("keeps a public auth page reachable without a session", async () => {
    const response = await proxy(request("/forbidden"));

    expect(response.status).toBe(200);
  });

  it("lets a system route bypass auth even when the client would throw", async () => {
    state.clientThrows = true;

    await expect(proxy(request("/api/health"))).resolves.toMatchObject({ status: 200 });
    await expect(proxy(request("/api/jobs/accrual"))).resolves.toMatchObject({ status: 200 });
  });
});

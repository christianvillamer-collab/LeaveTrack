import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  configured: true,
  signInError: null as null | { message: string },
  user: {
    id: "auth-subject",
    email: "maya.chen@leavetrack.demo",
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
  } as {
    id: string;
    email: string;
    email_confirmed_at: string | null;
  },
  identity: {
    user: { id: "a0000000-0000-4000-8000-000000000004", isActive: true },
    needsSubjectLink: false,
  } as null | {
    user: { id: string; isActive: boolean };
    needsSubjectLink: boolean;
  },
  signOutCalls: 0,
  applyCalls: 0,
  linkedSubjects: [] as string[],
}));

vi.mock("@/lib/auth/supabase", () => ({
  AuthConfigurationError: class AuthConfigurationError extends Error {},
  isAuthConfigured: () => state.configured,
  createSupabaseRouteClient: () => ({
    supabase: {
      auth: {
        signInWithPassword: async () => {
          if (state.signInError) {
            return { data: { user: null }, error: state.signInError };
          }

          return { data: { user: state.user }, error: null };
        },
        signOut: async () => {
          state.signOutCalls += 1;
          return { error: null };
        },
      },
    },
    applyTo: <T>(response: T): T => {
      state.applyCalls += 1;
      return response;
    },
  }),
}));

vi.mock("@/lib/db/users", () => ({
  resolveUserForIdentity: async () => state.identity,
  linkAuthSubject: async (_userId: string, subject: string) => {
    state.linkedSubjects.push(subject);
  },
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/auth/login/route";

const credentials = {
  email: "maya.chen@leavetrack.demo",
  password: "not-a-real-password",
};

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/auth/login", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formRequest(fields: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(() => {
  state.configured = true;
  state.signInError = null;
  state.user = {
    id: "auth-subject",
    email: "maya.chen@leavetrack.demo",
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
  };
  state.identity = {
    user: { id: "a0000000-0000-4000-8000-000000000004", isActive: true },
    needsSubjectLink: false,
  };
  state.signOutCalls = 0;
  state.applyCalls = 0;
  state.linkedSubjects = [];
});

describe("POST /auth/login", () => {
  it("returns only the validated destination for a hydrated form", async () => {
    const response = await POST(jsonRequest({ ...credentials, next: "/requests?status=pending" }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ redirectTo: "/requests?status=pending" });
    expect(body).not.toContain("__next_f");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.applyCalls).toBe(1);
  });

  it("rejects an unsafe next path", async () => {
    const response = await POST(jsonRequest({ ...credentials, next: "//evil.example/x" }));

    await expect(response.json()).resolves.toEqual({ redirectTo: "/dashboard" });
  });

  it("rejects bad credentials without starting a session", async () => {
    state.signInError = { message: "invalid" };

    const response = await POST(jsonRequest(credentials));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Email or password is incorrect.",
    });
    expect(state.signOutCalls).toBe(0);
    expect(state.applyCalls).toBe(1);
  });

  it("signs out an identity with no employee record", async () => {
    state.identity = null;

    const response = await POST(jsonRequest(credentials));

    expect(response.status).toBe(403);
    expect(state.signOutCalls).toBe(1);
    await expect(response.json()).resolves.toMatchObject({
      error: "No employee record is linked to this account. Contact HR.",
    });
  });

  it("303-redirects a no-JS form submission", async () => {
    const response = await POST(formRequest(credentials));

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/dashboard");
    expect(state.applyCalls).toBe(1);
  });

  it("fails closed when auth is not configured", async () => {
    state.configured = false;

    const response = await POST(jsonRequest(credentials));

    expect(response.status).toBe(503);
    expect(state.applyCalls).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  loginBodies: [] as Record<string, unknown>[],
  enabled: "true" as string | undefined,
  password: "server-only-demo-password" as string | undefined,
}));

vi.mock("@/app/auth/login/route", async () => {
  const { NextResponse: Response } = await import("next/server");

  return {
    POST: vi.fn(async (request: NextRequest) => {
      state.loginBodies.push((await request.json()) as Record<string, unknown>);
      return Response.json({ redirectTo: "/dashboard" });
    }),
  };
});

import { POST } from "@/app/auth/demo-login/route";

const original = {
  enabled: process.env.DEMO_LOGIN_ENABLED,
  password: process.env.DEMO_LOGIN_PASSWORD,
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/auth/demo-login", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.loginBodies = [];
  state.enabled = "true";
  state.password = "server-only-demo-password";

  process.env.DEMO_LOGIN_ENABLED = state.enabled;
  process.env.DEMO_LOGIN_PASSWORD = state.password;
});

afterEach(() => {
  if (original.enabled === undefined) delete process.env.DEMO_LOGIN_ENABLED;
  else process.env.DEMO_LOGIN_ENABLED = original.enabled;

  if (original.password === undefined) delete process.env.DEMO_LOGIN_PASSWORD;
  else process.env.DEMO_LOGIN_PASSWORD = original.password;
});

describe("POST /auth/demo-login", () => {
  it.each([
    ["employee", "maya.chen@leavetrack.demo"],
    ["manager", "daniel.okafor@leavetrack.demo"],
    ["hr_admin", "priya.nair@leavetrack.demo"],
  ])("signs in the allowlisted %s account", async (account, email) => {
    const response = await POST(request({ account, next: "/requests?status=pending" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ redirectTo: "/dashboard" });
    expect(state.loginBodies).toEqual([
      {
        email,
        password: "server-only-demo-password",
        next: "/requests?status=pending",
      },
    ]);
  });

  it("does not leak the demo password to the browser", async () => {
    const response = await POST(request({ account: "employee" }));
    const body = await response.text();

    expect(body).not.toContain("server-only-demo-password");
  });

  it("rejects an account outside the allowlist", async () => {
    const response = await POST(request({ account: "ceo" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose a valid demo account.",
    });
    expect(state.loginBodies).toEqual([]);
  });

  it("rejects a malformed body", async () => {
    const response = await POST(request(null));

    expect(response.status).toBe(400);
    expect(state.loginBodies).toEqual([]);
  });

  it("fails closed when demo sign-in is disabled", async () => {
    delete process.env.DEMO_LOGIN_ENABLED;

    const response = await POST(request({ account: "employee" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Demo sign-in is not available." });
    expect(state.loginBodies).toEqual([]);
  });

  it("fails closed when the demo password is missing", async () => {
    delete process.env.DEMO_LOGIN_PASSWORD;

    const response = await POST(request({ account: "employee" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Demo sign-in is not configured. Contact an administrator.",
    });
    expect(state.loginBodies).toEqual([]);
  });
});

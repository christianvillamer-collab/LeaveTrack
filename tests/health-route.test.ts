import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  database: "ok" as "ok" | "not_configured" | "error",
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    NEXT_PUBLIC_APP_URL: "",
    DATABASE_URL: "",
    DIRECT_URL: "",
    CRON_SECRET: "test-cron-secret",
    EMAIL_TRANSPORT: "log",
    EMAIL_API_KEY: "",
    EMAIL_FROM: "",
  },
}));

vi.mock("@/lib/config/env", () => ({ env: () => state.env }));

vi.mock("@/lib/db/client", () => ({
  checkDatabase: async () => state.database,
  getDb: () => {
    throw new Error("getDb must not be called by a route test");
  },
}));

import { GET } from "@/app/api/health/route";

function request(): NextRequest {
  return new NextRequest("http://localhost/api/health");
}

beforeEach(() => {
  state.database = "ok";
});

describe("GET /api/health", () => {
  it("returns a success envelope without requiring a session", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        status: "ok",
        checks: { database: "ok" },
      },
    });
    expect(body).not.toHaveProperty("error");
    expect(body.data).toHaveProperty("version");
    expect(body.data).toHaveProperty("timestamp");
  });

  it("treats a not-configured database as a healthy, degraded probe", async () => {
    state.database = "not_configured";
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { checks: { database: "not_configured" } },
    });
  });

  it("returns a 503 error envelope when the database probe fails", async () => {
    state.database = "error";
    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: expect.any(String) },
    });
  });
});

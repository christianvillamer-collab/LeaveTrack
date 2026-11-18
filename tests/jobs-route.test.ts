import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
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
  accrualCalls: [] as unknown[],
  outboxCalls: 0,
  getSessionCalls: 0,
}));

vi.mock("@/lib/config/env", () => ({ env: () => state.env }));

// The cron routes never read a user session. A mocked *valid* session is present
// throughout so the 401-without-bearer assertions prove a session is not enough.
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => {
    state.getSessionCalls += 1;
    return {
      id: "b0000000-0000-4000-8000-000000000003",
      role: "hr_admin" as const,
      name: "Priya Nair",
      email: "priya.nair@leavetrack.demo",
      managerId: null,
    };
  },
}));

vi.mock("@/lib/db/accrual", () => ({
  runAccrual: async (period: unknown) => {
    state.accrualCalls.push(period);
    return { period, processed: 0 };
  },
}));

vi.mock("@/lib/notifications/worker", () => ({
  runNotificationOutbox: async () => {
    state.outboxCalls += 1;
    return { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  },
}));

import { GET as getAccrual, POST as postAccrual } from "@/app/api/jobs/accrual/route";
import {
  GET as getNotificationJob,
  POST as postNotificationJob,
} from "@/app/api/jobs/notifications/route";

type Handler = (request: NextRequest) => Promise<Response>;

const handlers: ReadonlyArray<readonly [string, Handler]> = [
  ["GET /api/jobs/accrual", getAccrual],
  ["POST /api/jobs/accrual", postAccrual],
  ["GET /api/jobs/notifications", getNotificationJob],
  ["POST /api/jobs/notifications", postNotificationJob],
];

function request(authorization?: string): NextRequest {
  return new NextRequest("http://localhost/api/jobs", {
    headers: authorization ? { authorization } : undefined,
  });
}

function errorBody(response: Response, code: string) {
  return expect(response.json()).resolves.toEqual({
    success: false,
    error: { code, message: expect.any(String) },
  });
}

beforeEach(() => {
  state.env.CRON_SECRET = "test-cron-secret";
  state.accrualCalls = [];
  state.outboxCalls = 0;
  state.getSessionCalls = 0;
});

describe("cron job authorization", () => {
  for (const [name, handler] of handlers) {
    describe(name, () => {
      it("returns a 503 envelope when CRON_SECRET is not configured", async () => {
        state.env.CRON_SECRET = "";
        const response = await handler(request(`Bearer ${state.env.CRON_SECRET}`));

        expect(response.status).toBe(503);
        await errorBody(response, "INTERNAL_ERROR");
      });

      it("returns a 401 envelope when the bearer header is missing", async () => {
        const response = await handler(request());

        expect(response.status).toBe(401);
        await errorBody(response, "UNAUTHENTICATED");
      });

      it("returns a 401 envelope when the bearer secret is wrong", async () => {
        const response = await handler(request("Bearer not-the-secret"));

        expect(response.status).toBe(401);
        await errorBody(response, "UNAUTHENTICATED");
      });

      it("does not grant access from a valid user session alone", async () => {
        const response = await handler(request());

        expect(response.status).toBe(401);
        expect(state.getSessionCalls).toBe(0);
        await errorBody(response, "UNAUTHENTICATED");
      });

      it("returns a success envelope for a valid cron bearer", async () => {
        const response = await handler(request(`Bearer ${state.env.CRON_SECRET}`));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ success: true });
        expect(body).toHaveProperty("data");
        expect(body).not.toHaveProperty("error");
      });
    });
  }
});

describe("cron job delegation", () => {
  const authorization = `Bearer ${state.env.CRON_SECRET}`;

  it("runs accrual once for the current UTC month period", async () => {
    await getAccrual(request(authorization));

    expect(state.accrualCalls).toHaveLength(1);
    expect(state.accrualCalls[0]).toMatch(/^\d{4}-(0[1-9]|1[0-2])-01$/);
  });

  it("runs the notification outbox once per request", async () => {
    await postNotificationJob(request(authorization));

    expect(state.outboxCalls).toBe(1);
  });
});

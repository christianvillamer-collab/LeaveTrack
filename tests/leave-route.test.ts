import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | {
    id: string;
    role: "employee" | "manager" | "hr_admin";
    name: string;
    email: string;
    managerId: string | null;
  },
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
  createCalls: [] as unknown[],
  decideCalls: [] as unknown[],
  overrideCalls: [] as unknown[],
  mineCalls: [] as unknown[],
  teamCalls: [] as unknown[],
  createError: null as Error | null,
  decideError: null as Error | null,
  overrideError: null as Error | null,
}));

vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));

vi.mock("@/lib/config/env", () => ({ env: () => state.env }));

vi.mock("@/lib/db/leave", () => ({
  createLeaveRequest: async (input: unknown) => {
    state.createCalls.push(input);
    if (state.createError) throw state.createError;
    return { id: "created", status: "pending" };
  },
  listMyLeaveRequestsPage: async (userId: string, options: unknown) => {
    state.mineCalls.push({ userId, options });
    return { items: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 } };
  },
  listTeamLeaveRequestsPage: async (managerId: string, options: unknown) => {
    state.teamCalls.push({ managerId, options });
    return { items: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 } };
  },
  decideLeaveRequest: async (input: unknown) => {
    state.decideCalls.push(input);
    if (state.decideError) throw state.decideError;
    return { id: "decided", status: "approved" };
  },
  overrideLeaveRequest: async (input: unknown) => {
    state.overrideCalls.push(input);
    if (state.overrideError) throw state.overrideError;
    return { id: "overridden", status: "approved" };
  },
}));

import {
  GET as listLeaveRequests,
  POST as submitLeaveRequest,
} from "@/app/api/leave-requests/route";
import { POST as decideRequest } from "@/app/api/leave-requests/[id]/decision/route";
import { POST as overrideRequest } from "@/app/api/leave-requests/[id]/override/route";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

type Role = "employee" | "manager" | "hr_admin";

const EMPLOYEE = "b0000000-0000-4000-8000-000000000002";
const MANAGER = "b0000000-0000-4000-8000-000000000001";
const HR = "b0000000-0000-4000-8000-000000000003";
const LEAVE_TYPE = "11111111-1111-4111-8111-111111111111";
const REQUEST = "c0000000-0000-4000-8000-000000000001";

const validSubmission = {
  leaveTypeId: LEAVE_TYPE,
  startDate: "2026-06-01",
  endDate: "2026-06-02",
  reason: "Family event",
};

function sessionFor(role: Role) {
  return {
    id: role === "manager" ? MANAGER : role === "hr_admin" ? HR : EMPLOYEE,
    role,
    name: role === "manager" ? "Daniel Okafor" : role === "hr_admin" ? "Priya Nair" : "Maya Chen",
    email: `${role}@leavetrack.demo`,
    managerId: null,
  };
}

function get(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function conflict(message: string): AppError {
  return new AppError(ERROR_CODES.CONFLICT, message, 409);
}

function expectError(response: Response, code: string) {
  return expect(response.json()).resolves.toEqual({
    success: false,
    error: { code, message: expect.any(String) },
  });
}

beforeEach(() => {
  state.session = sessionFor("employee");
  state.createCalls = [];
  state.decideCalls = [];
  state.overrideCalls = [];
  state.mineCalls = [];
  state.teamCalls = [];
  state.createError = null;
  state.decideError = null;
  state.overrideError = null;
});

describe("POST /api/leave-requests", () => {
  it("returns a 201 success envelope and derives the user from the session", async () => {
    state.session = sessionFor("employee");
    const response = await submitLeaveRequest(post("/api/leave-requests", validSubmission));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: "created" },
    });
    expect(state.createCalls).toHaveLength(1);
    expect(state.createCalls[0]).toMatchObject({
      userId: EMPLOYEE,
      leaveTypeId: LEAVE_TYPE,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      reason: "Family event",
    });
  });

  it("returns a 401 envelope without a session", async () => {
    state.session = null;
    const response = await submitLeaveRequest(post("/api/leave-requests", validSubmission));

    expect(response.status).toBe(401);
    await expectError(response, "UNAUTHENTICATED");
    expect(state.createCalls).toHaveLength(0);
  });

  it("returns a 400 envelope for malformed JSON", async () => {
    const response = await submitLeaveRequest(
      new NextRequest("http://localhost/api/leave-requests", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expectError(response, "VALIDATION_ERROR");
    expect(state.createCalls).toHaveLength(0);
  });

  it("returns a 400 envelope for an invalid body", async () => {
    const response = await submitLeaveRequest(
      post("/api/leave-requests", { ...validSubmission, endDate: "2026-05-31" }),
    );

    expect(response.status).toBe(400);
    await expectError(response, "VALIDATION_ERROR");
    expect(state.createCalls).toHaveLength(0);
  });

  it("rejects a client-supplied userId via the strict schema", async () => {
    const response = await submitLeaveRequest(
      post("/api/leave-requests", {
        ...validSubmission,
        userId: "c0000000-0000-4000-8000-000000000009",
      }),
    );

    expect(response.status).toBe(400);
    await expectError(response, "VALIDATION_ERROR");
    expect(state.createCalls).toHaveLength(0);
  });
});

describe("GET /api/leave-requests scoping", () => {
  it("returns the caller's own page for scope=mine", async () => {
    state.session = sessionFor("employee");
    const response = await listLeaveRequests(get("/api/leave-requests?scope=mine"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(state.mineCalls).toHaveLength(1);
    expect(state.mineCalls[0]).toMatchObject({ userId: EMPLOYEE });
    expect(state.teamCalls).toHaveLength(0);
  });

  it("returns a manager-scoped page for scope=team using the session id", async () => {
    state.session = sessionFor("manager");
    const response = await listLeaveRequests(get("/api/leave-requests?scope=team"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(state.teamCalls).toHaveLength(1);
    expect(state.teamCalls[0]).toMatchObject({ managerId: MANAGER });
    expect(state.mineCalls).toHaveLength(0);
  });

  it("forbids scope=team for an employee", async () => {
    state.session = sessionFor("employee");
    const response = await listLeaveRequests(get("/api/leave-requests?scope=team"));

    expect(response.status).toBe(403);
    await expectError(response, "FORBIDDEN");
    expect(state.teamCalls).toHaveLength(0);
  });

  it("forbids scope=team for HR (the override is a separate route)", async () => {
    state.session = sessionFor("hr_admin");
    const response = await listLeaveRequests(get("/api/leave-requests?scope=team"));

    expect(response.status).toBe(403);
    await expectError(response, "FORBIDDEN");
    expect(state.teamCalls).toHaveLength(0);
  });

  it("returns a 401 envelope without a session", async () => {
    state.session = null;
    const response = await listLeaveRequests(get("/api/leave-requests"));

    expect(response.status).toBe(401);
    await expectError(response, "UNAUTHENTICATED");
  });
});

describe("POST /api/leave-requests/:id/decision", () => {
  const url = `/api/leave-requests/${REQUEST}/decision`;

  it("returns a 200 envelope and passes manager identity from the session", async () => {
    state.session = sessionFor("manager");
    const response = await decideRequest(post(url, { decision: "approved" }), routeParams(REQUEST));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: "decided" },
    });
    expect(state.decideCalls).toHaveLength(1);
    expect(state.decideCalls[0]).toMatchObject({
      requestId: REQUEST,
      managerId: MANAGER,
      managerName: "Daniel Okafor",
      decision: "approved",
    });
  });

  it("returns a 401 envelope without a session", async () => {
    state.session = null;
    const response = await decideRequest(post(url, { decision: "approved" }), routeParams(REQUEST));

    expect(response.status).toBe(401);
    await expectError(response, "UNAUTHENTICATED");
    expect(state.decideCalls).toHaveLength(0);
  });

  it("forbids an employee decision", async () => {
    state.session = sessionFor("employee");
    const response = await decideRequest(post(url, { decision: "approved" }), routeParams(REQUEST));

    expect(response.status).toBe(403);
    await expectError(response, "FORBIDDEN");
    expect(state.decideCalls).toHaveLength(0);
  });

  it("forbids an HR decision (HR must use the audited override)", async () => {
    state.session = sessionFor("hr_admin");
    const response = await decideRequest(post(url, { decision: "approved" }), routeParams(REQUEST));

    expect(response.status).toBe(403);
    await expectError(response, "FORBIDDEN");
    expect(state.decideCalls).toHaveLength(0);
  });

  it("returns a 404 envelope for a non-UUID request id", async () => {
    state.session = sessionFor("manager");
    const response = await decideRequest(
      post(url, { decision: "approved" }),
      routeParams("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    await expectError(response, "NOT_FOUND");
    expect(state.decideCalls).toHaveLength(0);
  });

  it("returns a 400 envelope when a rejection has no reason", async () => {
    state.session = sessionFor("manager");
    const response = await decideRequest(post(url, { decision: "rejected" }), routeParams(REQUEST));

    expect(response.status).toBe(400);
    await expectError(response, "VALIDATION_ERROR");
    expect(state.decideCalls).toHaveLength(0);
  });

  it("propagates a 409 conflict envelope from the transactional decision", async () => {
    state.session = sessionFor("manager");
    state.decideError = conflict("This request has already been decided.");
    const response = await decideRequest(post(url, { decision: "approved" }), routeParams(REQUEST));

    expect(response.status).toBe(409);
    await expectError(response, "CONFLICT");
  });
});

describe("POST /api/leave-requests/:id/override", () => {
  const url = `/api/leave-requests/${REQUEST}/override`;
  const body = { override: true, decision: "approved", reason: "Manager unavailable" };

  it("returns a 200 envelope and passes HR identity from the session", async () => {
    state.session = sessionFor("hr_admin");
    const response = await overrideRequest(post(url, body), routeParams(REQUEST));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: "overridden" },
    });
    expect(state.overrideCalls).toHaveLength(1);
    expect(state.overrideCalls[0]).toMatchObject({
      requestId: REQUEST,
      actorId: HR,
      actorName: "Priya Nair",
      decision: "approved",
      reason: "Manager unavailable",
    });
  });

  it("returns a 401 envelope without a session", async () => {
    state.session = null;
    const response = await overrideRequest(post(url, body), routeParams(REQUEST));

    expect(response.status).toBe(401);
    await expectError(response, "UNAUTHENTICATED");
    expect(state.overrideCalls).toHaveLength(0);
  });

  it("forbids an employee override", async () => {
    state.session = sessionFor("employee");
    const response = await overrideRequest(post(url, body), routeParams(REQUEST));

    expect(response.status).toBe(403);
    await expectError(response, "FORBIDDEN");
    expect(state.overrideCalls).toHaveLength(0);
  });

  it("forbids a manager override", async () => {
    state.session = sessionFor("manager");
    const response = await overrideRequest(post(url, body), routeParams(REQUEST));

    expect(response.status).toBe(403);
    await expectError(response, "FORBIDDEN");
    expect(state.overrideCalls).toHaveLength(0);
  });

  it("returns a 404 envelope for a non-UUID request id", async () => {
    state.session = sessionFor("hr_admin");
    const response = await overrideRequest(post(url, body), routeParams("not-a-uuid"));

    expect(response.status).toBe(404);
    await expectError(response, "NOT_FOUND");
    expect(state.overrideCalls).toHaveLength(0);
  });

  it("returns a 400 envelope without the explicit override flag", async () => {
    state.session = sessionFor("hr_admin");
    const response = await overrideRequest(
      post(url, { decision: "approved", reason: "Manager unavailable" }),
      routeParams(REQUEST),
    );

    expect(response.status).toBe(400);
    await expectError(response, "VALIDATION_ERROR");
    expect(state.overrideCalls).toHaveLength(0);
  });

  it("returns a 400 envelope for a too-short reason", async () => {
    state.session = sessionFor("hr_admin");
    const response = await overrideRequest(
      post(url, { ...body, reason: "no" }),
      routeParams(REQUEST),
    );

    expect(response.status).toBe(400);
    await expectError(response, "VALIDATION_ERROR");
    expect(state.overrideCalls).toHaveLength(0);
  });

  it("propagates a 409 conflict envelope from the transactional override", async () => {
    state.session = sessionFor("hr_admin");
    state.overrideError = conflict("This request has already been decided.");
    const response = await overrideRequest(post(url, body), routeParams(REQUEST));

    expect(response.status).toBe(409);
    await expectError(response, "CONFLICT");
  });
});

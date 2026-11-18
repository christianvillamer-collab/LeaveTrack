import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | {
    id: string;
    role: "employee" | "manager" | "hr_admin";
    name: string;
    email: string;
  },
  mineCalls: [] as unknown[],
  teamCalls: [] as unknown[],
  auditCalls: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => state.session,
}));

vi.mock("@/lib/db/leave", () => ({
  createLeaveRequest: async () => ({}),
  listMyLeaveRequestsPage: async (userId: string, options: unknown) => {
    state.mineCalls.push({ userId, options });
    return { items: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 } };
  },
  listTeamLeaveRequestsPage: async (managerId: string, options: unknown) => {
    state.teamCalls.push({ managerId, options });
    return { items: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 } };
  },
}));

vi.mock("@/lib/db/audit", () => ({
  getAuditReport: async (userId: string, options: unknown) => {
    state.auditCalls.push({ userId, options });
    return {
      employee: {
        id: userId,
        name: "Maya Chen",
        email: "maya.chen@leavetrack.demo",
        role: "employee" as const,
      },
      requests: [],
      events: [],
      pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 },
    };
  },
}));

import { GET as getAuditReport } from "@/app/api/audit/[userId]/route";
import { GET as getLeaveRequests } from "@/app/api/leave-requests/route";
import { auditReportQuerySchema, resolveAuditReportQuery } from "@/lib/validation/audit";
import { leaveRequestListQuerySchema } from "@/lib/validation/leave";
import { exportAllQuerySchema, listQuerySchema, toPaginationMeta } from "@/lib/validation/list";

const employeeId = "b0000000-0000-4000-8000-000000000002";
const managerId = "b0000000-0000-4000-8000-000000000001";

const employee = {
  id: employeeId,
  role: "employee" as const,
  name: "Maya Chen",
  email: "maya.chen@leavetrack.demo",
};

const manager = {
  id: managerId,
  role: "manager" as const,
  name: "Daniel Okafor",
  email: "daniel.okafor@leavetrack.demo",
};

const hr = {
  id: "b0000000-0000-4000-8000-000000000003",
  role: "hr_admin" as const,
  name: "Priya Nair",
  email: "priya.nair@leavetrack.demo",
};

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  state.session = employee;
  state.mineCalls = [];
  state.teamCalls = [];
  state.auditCalls = [];
});

describe("shared list validation", () => {
  it("defaults to page 1 and 25 rows", () => {
    expect(listQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    expect(listQuerySchema.parse({ page: "", pageSize: "" })).toMatchObject({
      page: 1,
      pageSize: 25,
    });
  });

  it("accepts an optional status and bounded paging", () => {
    expect(listQuerySchema.parse({ status: "pending", page: "2", pageSize: "100" })).toMatchObject({
      status: "pending",
      page: 2,
      pageSize: 100,
    });
  });

  it("rejects unknown statuses, bad numbers, repeated params, and oversized pages", () => {
    for (const input of [
      { status: "unknown" },
      { page: "abc" },
      { page: "0" },
      { page: "1.5" },
      { pageSize: "101" },
      { page: ["1", "2"] },
      { status: ["pending", "approved"] },
    ]) {
      expect(listQuerySchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it("parses only explicit export flags", () => {
    expect(exportAllQuerySchema.parse("1")).toBe(true);
    expect(exportAllQuerySchema.parse("true")).toBe(true);
    expect(exportAllQuerySchema.parse("0")).toBe(false);
    expect(exportAllQuerySchema.parse("")).toBe(false);
    expect(exportAllQuerySchema.safeParse("yes").success).toBe(false);
  });

  it("computes stable pagination metadata", () => {
    expect(toPaginationMeta(0, 1, 25)).toEqual({ total: 0, page: 1, pageSize: 25, pageCount: 1 });
    expect(toPaginationMeta(101, 3, 25)).toEqual({
      total: 101,
      page: 3,
      pageSize: 25,
      pageCount: 5,
    });
  });

  it("composes the leave request query contract", () => {
    expect(leaveRequestListQuerySchema.parse({})).toMatchObject({ scope: "mine" });
    expect(
      leaveRequestListQuerySchema.parse({ scope: "team", status: "approved", page: "2" }),
    ).toMatchObject({ scope: "team", status: "approved", page: 2 });
  });
});

describe("audit query validation", () => {
  it("accepts status, paging, and exportAll alongside existing filters", () => {
    const parsed = auditReportQuerySchema.parse({
      employee: employeeId,
      from: "2026-11-01",
      to: "2026-11-30",
      status: "approved",
      page: "2",
      pageSize: "10",
      exportAll: "1",
    });

    expect(parsed).toMatchObject({
      employee: employeeId,
      from: "2026-11-01",
      to: "2026-11-30",
      status: "approved",
      page: 2,
      pageSize: 10,
      exportAll: true,
    });
  });

  it("fails closed for invalid list filters", () => {
    for (const input of [{ status: "maybe" }, { page: "0" }, { exportAll: "yes" }]) {
      const result = resolveAuditReportQuery(input);
      expect(result.valid, JSON.stringify(input)).toBe(false);
      if (!result.valid) expect(result.query).toBeNull();
    }
  });
});

describe("GET /api/leave-requests", () => {
  it("returns the 401 envelope without a session", async () => {
    state.session = null;
    const response = await getLeaveRequests(request("/api/leave-requests"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("paginates and filters the employee list server-side", async () => {
    const response = await getLeaveRequests(
      request("/api/leave-requests?status=pending&page=2&pageSize=10"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(state.mineCalls).toEqual([
      { userId: employeeId, options: { status: "pending", page: 2, pageSize: 10 } },
    ]);
    expect(state.teamCalls).toHaveLength(0);
  });

  it("keeps scope=team manager-only", async () => {
    const denied = await getLeaveRequests(request("/api/leave-requests?scope=team"));
    expect(denied.status).toBe(403);
    expect(state.teamCalls).toHaveLength(0);

    state.session = manager;
    const allowed = await getLeaveRequests(
      request("/api/leave-requests?scope=team&status=approved&page=3"),
    );
    expect(allowed.status).toBe(200);
    expect(state.teamCalls).toEqual([
      { managerId: managerId, options: { status: "approved", page: 3, pageSize: 25 } },
    ]);
    expect(state.mineCalls).toHaveLength(0);
  });

  it("returns 400 for invalid list filters without querying", async () => {
    const response = await getLeaveRequests(request("/api/leave-requests?page=0&status=unknown"));
    expect(response.status).toBe(400);
    expect(state.mineCalls).toHaveLength(0);
    expect(state.teamCalls).toHaveLength(0);
  });
});

describe("GET /api/audit/:userId", () => {
  function context(userId = employeeId) {
    return { params: Promise.resolve({ userId }) };
  }

  it("requires HR access", async () => {
    state.session = null;
    const anonymous = await getAuditReport(request(`/api/audit/${employeeId}`), context());
    expect(anonymous.status).toBe(401);

    state.session = manager;
    const denied = await getAuditReport(request(`/api/audit/${employeeId}`), context());
    expect(denied.status).toBe(403);
    expect(state.auditCalls).toHaveLength(0);
  });

  it("rejects non-UUID employee ids as 404", async () => {
    state.session = hr;
    const response = await getAuditReport(request("/api/audit/maya"), context("maya"));
    expect(response.status).toBe(404);
    expect(state.auditCalls).toHaveLength(0);
  });

  it("forwards status, paging, and exportAll to the report", async () => {
    state.session = hr;
    const response = await getAuditReport(
      request(
        `/api/audit/${employeeId}?status=rejected&page=2&pageSize=10&from=2026-11-01&to=2026-11-30&exportAll=1`,
      ),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(state.auditCalls).toEqual([
      {
        userId: employeeId,
        options: {
          from: "2026-11-01",
          to: "2026-11-30",
          status: "rejected",
          page: 2,
          pageSize: 10,
          exportAll: true,
        },
      },
    ]);
  });

  it("returns 400 for invalid filters without querying", async () => {
    state.session = hr;
    const response = await getAuditReport(
      request(`/api/audit/${employeeId}?page=abc&status=unknown`),
      context(),
    );
    expect(response.status).toBe(400);
    expect(state.auditCalls).toHaveLength(0);
  });
});

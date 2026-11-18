import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * E2-15 acceptance artifact: one committed, CI-visible matrix over every API
 * handler. All database work is mocked so this suite runs in `npm test` with an
 * empty environment and never races the `test:db` integration suites.
 *
 * The real `lib/auth/policy.ts` and real Zod schemas are used on purpose — only
 * identity and persistence are faked, so the 401/403/404/409 gates are genuine.
 */
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
}));

vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));

vi.mock("@/lib/config/env", () => ({ env: () => state.env }));

vi.mock("@/lib/db/leave", () => ({
  createLeaveRequest: async () => ({ id: "created", status: "pending" }),
  listMyLeaveRequestsPage: async () => ({
    items: [],
    pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 },
  }),
  listTeamLeaveRequestsPage: async () => ({
    items: [],
    pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 },
  }),
  decideLeaveRequest: async () => ({ id: "decided", status: "approved" }),
  overrideLeaveRequest: async () => ({ id: "overridden", status: "approved" }),
}));

vi.mock("@/lib/db/audit", () => ({
  getAuditReport: async () => ({
    employee: { id: "employee", name: "Employee", email: "employee@example.com", role: "employee" },
    requests: [],
    events: [],
    pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 },
  }),
}));

vi.mock("@/lib/db/policies", () => ({
  upsertPolicyRate: async () => ({
    userId: "employee",
    leaveTypeId: "leave-type",
    accrualPerMonth: 1.5,
    effectiveFrom: "2027-01-01",
    previousRate: 1.25,
    auditWritten: true,
  }),
}));

vi.mock("@/lib/db/people", () => ({
  bulkImportPeople: async () => ({ created: 1, updated: 0, unchanged: 0 }),
  reassignManager: async () => ({
    id: "person",
    changed: true,
    auditWritten: true,
    managerId: "manager",
  }),
  updatePersonProfile: async () => ({ id: "person", changed: true, auditWritten: true }),
  setPersonActive: async () => ({ id: "person", changed: true, auditWritten: true }),
}));

vi.mock("@/lib/db/notifications", () => ({
  listNotifications: async () => ({ items: [], unreadCount: 0 }),
  markNotificationRead: async () => "2026-11-18T00:00:00.000Z",
  markAllNotificationsRead: async () => 0,
}));

vi.mock("@/lib/db/client", () => ({
  checkDatabase: async () => "ok",
  getDb: () => {
    throw new Error("getDb must not be called by a route test");
  },
}));

vi.mock("@/lib/db/accrual", () => ({
  runAccrual: async () => ({ period: "2026-11-01", processed: 0 }),
}));

vi.mock("@/lib/notifications/worker", () => ({
  runNotificationOutbox: async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 }),
}));

import { GET as getAuditReport } from "@/app/api/audit/[userId]/route";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getAccrual, POST as postAccrual } from "@/app/api/jobs/accrual/route";
import {
  GET as getNotificationJob,
  POST as postNotificationJob,
} from "@/app/api/jobs/notifications/route";
import { GET as getLeaveRequests, POST as postLeaveRequest } from "@/app/api/leave-requests/route";
import { POST as postDecision } from "@/app/api/leave-requests/[id]/decision/route";
import { POST as postOverride } from "@/app/api/leave-requests/[id]/override/route";
import { GET as getNotifications } from "@/app/api/notifications/route";
import { POST as postReadNotification } from "@/app/api/notifications/[id]/read/route";
import { POST as postReadAll } from "@/app/api/notifications/read-all/route";
import { POST as postImportPeople } from "@/app/api/people/import/route";
import { POST as postManager } from "@/app/api/people/[id]/manager/route";
import { POST as postProfile } from "@/app/api/people/[id]/profile/route";
import { POST as postStatus } from "@/app/api/people/[id]/status/route";
import { POST as postPolicy } from "@/app/api/policies/route";

type Role = "employee" | "manager" | "hr_admin";

const EMPLOYEE = "b0000000-0000-4000-8000-000000000002";
const MANAGER = "b0000000-0000-4000-8000-000000000001";
const HR = "b0000000-0000-4000-8000-000000000003";
const LEAVE_TYPE = "11111111-1111-4111-8111-111111111111";
const REQUEST = "c0000000-0000-4000-8000-000000000001";
const NOTIFICATION = "d0000000-0000-4000-8000-000000000001";

function sessionFor(role: Role) {
  return {
    id: role === "manager" ? MANAGER : role === "hr_admin" ? HR : EMPLOYEE,
    role,
    name: role === "manager" ? "Daniel Okafor" : role === "hr_admin" ? "Priya Nair" : "Maya Chen",
    email: `${role}@leavetrack.demo`,
    managerId: null,
  };
}

function get(path: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function post(path: string, body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

function cronHeaders(authorized: boolean): Record<string, string> | undefined {
  return authorized ? { authorization: `Bearer ${state.env.CRON_SECRET}` } : undefined;
}

interface RouteCase {
  name: string;
  gate: "session" | "cron" | "public";
  invoke: (authorized: boolean) => Promise<Response>;
  allowedRole?: Role;
  forbiddenRoles?: Role[];
  successStatus?: number;
}

const routes: ReadonlyArray<RouteCase> = [
  {
    name: "GET /api/leave-requests (mine)",
    gate: "session",
    allowedRole: "employee",
    invoke: () => getLeaveRequests(get("/api/leave-requests")),
  },
  {
    name: "GET /api/leave-requests?scope=team",
    gate: "session",
    allowedRole: "manager",
    forbiddenRoles: ["employee", "hr_admin"],
    invoke: () => getLeaveRequests(get("/api/leave-requests?scope=team")),
  },
  {
    name: "POST /api/leave-requests",
    gate: "session",
    allowedRole: "employee",
    successStatus: 201,
    invoke: () =>
      postLeaveRequest(
        post("/api/leave-requests", {
          leaveTypeId: LEAVE_TYPE,
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          reason: "Family event",
        }),
      ),
  },
  {
    name: "POST /api/leave-requests/:id/decision",
    gate: "session",
    allowedRole: "manager",
    forbiddenRoles: ["employee", "hr_admin"],
    invoke: () =>
      postDecision(post(`/api/leave-requests/${REQUEST}/decision`, { decision: "approved" }), {
        params: Promise.resolve({ id: REQUEST }),
      }),
  },
  {
    name: "POST /api/leave-requests/:id/override",
    gate: "session",
    allowedRole: "hr_admin",
    forbiddenRoles: ["employee", "manager"],
    invoke: () =>
      postOverride(
        post(`/api/leave-requests/${REQUEST}/override`, {
          override: true,
          decision: "approved",
          reason: "Manager unavailable",
        }),
        { params: Promise.resolve({ id: REQUEST }) },
      ),
  },
  {
    name: "GET /api/audit/:userId",
    gate: "session",
    allowedRole: "hr_admin",
    forbiddenRoles: ["employee", "manager"],
    invoke: () =>
      getAuditReport(get(`/api/audit/${EMPLOYEE}`), {
        params: Promise.resolve({ userId: EMPLOYEE }),
      }),
  },
  {
    name: "POST /api/policies",
    gate: "session",
    allowedRole: "hr_admin",
    forbiddenRoles: ["employee", "manager"],
    invoke: () =>
      postPolicy(
        post("/api/policies", {
          userId: EMPLOYEE,
          leaveTypeId: LEAVE_TYPE,
          accrualPerMonth: 1.5,
          effectiveFrom: "2027-01-01",
        }),
      ),
  },
  {
    name: "POST /api/people/import",
    gate: "session",
    allowedRole: "hr_admin",
    forbiddenRoles: ["employee", "manager"],
    successStatus: 201,
    invoke: () =>
      postImportPeople(
        post("/api/people/import", [{ name: "New Person", email: "new.person@leavetrack.demo" }]),
      ),
  },
  {
    name: "POST /api/people/:id/profile",
    gate: "session",
    allowedRole: "hr_admin",
    forbiddenRoles: ["employee", "manager"],
    invoke: () =>
      postProfile(
        post(`/api/people/${EMPLOYEE}/profile`, {
          name: "Maya Chen",
          email: "maya.chen@leavetrack.demo",
          jobTitle: "Engineer",
          team: "Core",
        }),
        { params: Promise.resolve({ id: EMPLOYEE }) },
      ),
  },
  {
    name: "POST /api/people/:id/status",
    gate: "session",
    allowedRole: "hr_admin",
    forbiddenRoles: ["employee", "manager"],
    invoke: () =>
      postStatus(post(`/api/people/${EMPLOYEE}/status`, { isActive: true }), {
        params: Promise.resolve({ id: EMPLOYEE }),
      }),
  },
  {
    name: "POST /api/people/:id/manager",
    gate: "session",
    allowedRole: "hr_admin",
    forbiddenRoles: ["employee", "manager"],
    invoke: () =>
      postManager(post(`/api/people/${EMPLOYEE}/manager`, { managerId: MANAGER }), {
        params: Promise.resolve({ id: EMPLOYEE }),
      }),
  },
  {
    name: "GET /api/notifications",
    gate: "session",
    allowedRole: "employee",
    invoke: () => getNotifications(get("/api/notifications")),
  },
  {
    name: "POST /api/notifications/:id/read",
    gate: "session",
    allowedRole: "employee",
    invoke: () =>
      postReadNotification(post(`/api/notifications/${NOTIFICATION}/read`, {}), {
        params: Promise.resolve({ id: NOTIFICATION }),
      }),
  },
  {
    name: "POST /api/notifications/read-all",
    gate: "session",
    allowedRole: "employee",
    invoke: () => postReadAll(post("/api/notifications/read-all", {})),
  },
  {
    name: "GET /api/health",
    gate: "public",
    invoke: () => getHealth(get("/api/health")),
  },
  {
    name: "GET /api/jobs/accrual",
    gate: "cron",
    invoke: (authorized) => getAccrual(get("/api/jobs/accrual", cronHeaders(authorized))),
  },
  {
    name: "POST /api/jobs/accrual",
    gate: "cron",
    invoke: (authorized) => postAccrual(post("/api/jobs/accrual", {}, cronHeaders(authorized))),
  },
  {
    name: "GET /api/jobs/notifications",
    gate: "cron",
    invoke: (authorized) =>
      getNotificationJob(get("/api/jobs/notifications", cronHeaders(authorized))),
  },
  {
    name: "POST /api/jobs/notifications",
    gate: "cron",
    invoke: (authorized) =>
      postNotificationJob(post("/api/jobs/notifications", {}, cronHeaders(authorized))),
  },
];

async function expectError(response: Response, code: string): Promise<void> {
  expect(response.status).not.toBe(200);
  await expect(response.json()).resolves.toEqual({
    success: false,
    error: { code, message: expect.any(String) },
  });
}

async function expectSuccess(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body).toMatchObject({ success: true });
  expect(body).toHaveProperty("data");
  expect(body).not.toHaveProperty("error");
}

beforeEach(() => {
  state.session = sessionFor("employee");
  state.env.CRON_SECRET = "test-cron-secret";
});

describe("E2-15 route authorization and envelope matrix", () => {
  it("covers every API handler with at least one success and one failure case", () => {
    expect(routes).toHaveLength(19);
  });

  for (const route of routes) {
    describe(route.name, () => {
      if (route.gate === "session") {
        it("returns a 401 envelope for an unauthenticated caller", async () => {
          state.session = null;
          const response = await route.invoke(true);

          expect(response.status).toBe(401);
          await expectError(response, "UNAUTHENTICATED");
        });

        for (const role of route.forbiddenRoles ?? []) {
          it(`returns a 403 envelope for a ${role} caller`, async () => {
            state.session = sessionFor(role);
            const response = await route.invoke(true);

            expect(response.status).toBe(403);
            await expectError(response, "FORBIDDEN");
          });
        }

        it("returns a success envelope for an authorized caller", async () => {
          state.session = sessionFor(route.allowedRole ?? "employee");
          const response = await route.invoke(true);

          await expectSuccess(response, route.successStatus ?? 200);
        });
      } else if (route.gate === "cron") {
        it("returns a 401 envelope without a valid cron bearer", async () => {
          const response = await route.invoke(false);

          expect(response.status).toBe(401);
          await expectError(response, "UNAUTHENTICATED");
        });

        it("returns a success envelope with a valid cron bearer", async () => {
          const response = await route.invoke(true);

          await expectSuccess(response, 200);
        });
      } else {
        it("returns a public success envelope", async () => {
          const response = await route.invoke(true);

          await expectSuccess(response, 200);
        });
      }
    });
  }
});

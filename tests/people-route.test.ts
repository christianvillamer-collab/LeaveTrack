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
  profileCalls: [] as unknown[],
  managerCalls: [] as unknown[],
  statusCalls: [] as unknown[],
  importCalls: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => state.session,
}));

vi.mock("@/lib/db/people", () => ({
  updatePersonProfile: async (actorId: string, subjectId: string, input: unknown) => {
    state.profileCalls.push({ actorId, subjectId, input });
    return { id: subjectId, changed: true, auditWritten: true };
  },
  reassignManager: async (actorId: string, subjectId: string, managerId: string | null) => {
    state.managerCalls.push({ actorId, subjectId, managerId });
    return { id: subjectId, changed: true, auditWritten: true, managerId };
  },
  setPersonActive: async (
    actorId: string,
    subjectId: string,
    isActive: boolean,
    reason?: string,
  ) => {
    state.statusCalls.push({ actorId, subjectId, isActive, reason });
    return { id: subjectId, changed: true, auditWritten: true, isActive };
  },
  bulkImportPeople: async (actorId: string, rows: unknown) => {
    state.importCalls.push({ actorId, rows });
    return { created: 1, updated: 0, skipped: 0 };
  },
}));

import { POST as importPeople } from "@/app/api/people/import/route";
import { POST as assignManager } from "@/app/api/people/[id]/manager/route";
import { POST as updateProfile } from "@/app/api/people/[id]/profile/route";
import { POST as setStatus } from "@/app/api/people/[id]/status/route";

const subjectId = "a0000000-0000-4000-8000-000000000004";

const hr = {
  id: "a0000000-0000-4000-8000-000000000003",
  role: "hr_admin" as const,
  name: "Priya Nair",
  email: "priya.nair@leavetrack.demo",
  managerId: null,
};

const validProfile = {
  name: "Maya Chen",
  email: "maya.chen@leavetrack.demo",
  jobTitle: "Product Designer",
  team: "Product",
};

function request(body: unknown, path = "/api/people"): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id = subjectId) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  state.session = hr;
  state.profileCalls = [];
  state.managerCalls = [];
  state.statusCalls = [];
  state.importCalls = [];
});

describe("POST /api/people/:id/profile", () => {
  it("returns 401 without a session", async () => {
    state.session = null;

    const response = await updateProfile(request(validProfile), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(state.profileCalls).toHaveLength(0);
  });

  it("returns 403 for employees and managers", async () => {
    for (const role of ["employee", "manager"] as const) {
      state.session = { ...hr, role };

      const response = await updateProfile(request(validProfile), context());

      expect(response.status, role).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: "FORBIDDEN" },
      });
    }

    expect(state.profileCalls).toHaveLength(0);
  });

  it("returns 400 for a malformed body or an invalid id", async () => {
    const malformed = await updateProfile(
      new NextRequest("http://localhost/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      context(),
    );
    expect(malformed.status).toBe(400);

    const badId = await updateProfile(request(validProfile), context("not-a-uuid"));
    expect(badId.status).toBe(400);

    expect(state.profileCalls).toHaveLength(0);
  });

  it("delegates with the session actor and returns the result", async () => {
    const response = await updateProfile(request(validProfile), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: subjectId, changed: true, auditWritten: true },
    });
    expect(state.profileCalls).toEqual([{ actorId: hr.id, subjectId, input: validProfile }]);
  });
});

describe("POST /api/people/:id/manager", () => {
  it("accepts null to remove a reporting line", async () => {
    const response = await assignManager(request({ managerId: null }), context());

    expect(response.status).toBe(200);
    expect(state.managerCalls).toEqual([{ actorId: hr.id, subjectId, managerId: null }]);
  });

  it("rejects a non-uuid manager", async () => {
    const response = await assignManager(request({ managerId: "daniel" }), context());

    expect(response.status).toBe(400);
    expect(state.managerCalls).toHaveLength(0);
  });
});

describe("POST /api/people/:id/status", () => {
  it("requires a reason to deactivate", async () => {
    const response = await setStatus(request({ isActive: false }), context());

    expect(response.status).toBe(400);
    expect(state.statusCalls).toHaveLength(0);
  });

  it("passes the deactivation reason to the data layer", async () => {
    const response = await setStatus(
      request({ isActive: false, reason: "Left the company" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(state.statusCalls).toEqual([
      { actorId: hr.id, subjectId, isActive: false, reason: "Left the company" },
    ]);
  });

  it("reactivates without a reason", async () => {
    const response = await setStatus(request({ isActive: true }), context());

    expect(response.status).toBe(200);
    expect(state.statusCalls).toEqual([
      { actorId: hr.id, subjectId, isActive: true, reason: undefined },
    ]);
  });
});

describe("POST /api/people/import", () => {
  it("returns 201 and maps validated rows", async () => {
    const managerEmail = "daniel.okafor@leavetrack.demo";

    const response = await importPeople(
      request([
        {
          name: "Alex Rivera",
          email: "alex.rivera@leavetrack.demo",
          managerEmail,
          jobTitle: "",
        },
      ]),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { created: 1, updated: 0, skipped: 0 },
    });
    expect(state.importCalls).toEqual([
      {
        actorId: hr.id,
        rows: [
          {
            name: "Alex Rivera",
            email: "alex.rivera@leavetrack.demo",
            role: undefined,
            managerEmail,
            jobTitle: null,
            // Omitted stays undefined so the data layer leaves it unchanged.
            team: undefined,
          },
        ],
      },
    ]);
  });

  it("rejects a duplicate email batch before touching the data layer", async () => {
    const response = await importPeople(
      request([
        { name: "Alex Rivera", email: "alex.rivera@leavetrack.demo" },
        { name: "Alex Again", email: "ALEX.RIVERA@leavetrack.demo" },
      ]),
    );

    expect(response.status).toBe(400);
    expect(state.importCalls).toHaveLength(0);
  });
});

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
  upsertCalls: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => state.session,
}));

vi.mock("@/lib/db/policies", () => ({
  upsertPolicyRate: async (input: unknown) => {
    state.upsertCalls.push(input);
    return {
      userId: "a0000000-0000-4000-8000-000000000004",
      leaveTypeId: "11111111-1111-4111-8111-111111111111",
      accrualPerMonth: 1.5,
      effectiveFrom: "2027-01-01",
      previousRate: 1.25,
      auditWritten: true,
    };
  },
}));

import { POST } from "@/app/api/policies/route";

const hr = {
  id: "a0000000-0000-4000-8000-000000000003",
  role: "hr_admin" as const,
  name: "Priya Nair",
  email: "priya.nair@leavetrack.demo",
  managerId: null,
};

const validBody = {
  userId: "a0000000-0000-4000-8000-000000000004",
  leaveTypeId: "11111111-1111-4111-8111-111111111111",
  accrualPerMonth: 1.5,
  effectiveFrom: "2027-01-01",
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/policies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = hr;
  state.upsertCalls = [];
});

describe("POST /api/policies", () => {
  it("returns 401 when there is no session", async () => {
    state.session = null;

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(state.upsertCalls).toHaveLength(0);
  });

  it("returns 403 for employees and managers", async () => {
    for (const role of ["employee", "manager"] as const) {
      state.session = { ...hr, role };

      const response = await POST(request(validBody));

      expect(response.status, role).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: { code: "FORBIDDEN" },
      });
    }

    expect(state.upsertCalls).toHaveLength(0);
  });

  it("returns 400 for a malformed body", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("returns 400 when the effective date is not a month start", async () => {
    const response = await POST(request({ ...validBody, effectiveFrom: "2027-01-15" }));

    expect(response.status).toBe(400);
    expect(state.upsertCalls).toHaveLength(0);
  });

  it("delegates to the DB layer with the session actor and returns 200", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        userId: validBody.userId,
        effectiveFrom: validBody.effectiveFrom,
        auditWritten: true,
      },
    });
    expect(state.upsertCalls).toEqual([
      {
        actorId: hr.id,
        userId: validBody.userId,
        leaveTypeId: validBody.leaveTypeId,
        accrualPerMonth: validBody.accrualPerMonth,
        effectiveFrom: validBody.effectiveFrom,
      },
    ]);
  });
});

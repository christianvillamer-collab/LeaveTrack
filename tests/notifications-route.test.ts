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
  listCalls: [] as unknown[],
  readCalls: [] as unknown[],
  readAllCalls: [] as unknown[],
  readResult: "2026-05-01T10:00:00.000Z" as string | null,
  readAllResult: 2,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => state.session,
}));

vi.mock("@/lib/db/notifications", () => ({
  listNotifications: async (recipientId: string, options: unknown) => {
    state.listCalls.push({ recipientId, options });
    return { items: [], unreadCount: 0 };
  },
  markNotificationRead: async (recipientId: string, id: string) => {
    state.readCalls.push({ recipientId, id });
    return state.readResult;
  },
  markAllNotificationsRead: async (recipientId: string) => {
    state.readAllCalls.push({ recipientId });
    return state.readAllResult;
  },
}));

import { GET as listRoute } from "@/app/api/notifications/route";
import { POST as readRoute } from "@/app/api/notifications/[id]/read/route";
import { POST as readAllRoute } from "@/app/api/notifications/read-all/route";

const maya = {
  id: "a0000000-0000-4000-8000-000000000004",
  role: "employee" as const,
  name: "Maya Chen",
  email: "maya.chen@leavetrack.demo",
  managerId: "a0000000-0000-4000-8000-000000000001",
};

const notificationId = "c0000000-0000-4000-8000-000000000001";

function getRequest(path = "/api/notifications"): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function postRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "POST" });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  state.session = maya;
  state.listCalls = [];
  state.readCalls = [];
  state.readAllCalls = [];
  state.readResult = "2026-05-01T10:00:00.000Z";
  state.readAllResult = 2;
});

describe("GET /api/notifications", () => {
  it("returns 401 without a session", async () => {
    state.session = null;

    const response = await listRoute(getRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(state.listCalls).toHaveLength(0);
  });

  it("scopes the list to the session and applies the limit", async () => {
    const response = await listRoute(getRequest("/api/notifications?limit=10"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { items: [], unreadCount: 0 },
    });
    expect(state.listCalls).toEqual([{ recipientId: maya.id, options: { limit: 10 } }]);
  });

  it("defaults the limit to 50", async () => {
    await listRoute(getRequest());

    expect(state.listCalls).toEqual([{ recipientId: maya.id, options: { limit: 50 } }]);
  });

  it("returns 400 for an invalid limit", async () => {
    const response = await listRoute(getRequest("/api/notifications?limit=500"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(state.listCalls).toHaveLength(0);
  });
});

describe("POST /api/notifications/:id/read", () => {
  it("returns 401 without a session", async () => {
    state.session = null;

    const response = await readRoute(
      postRequest(`/api/notifications/${notificationId}/read`),
      context(notificationId),
    );

    expect(response.status).toBe(401);
    expect(state.readCalls).toHaveLength(0);
  });

  it("returns 404 for an invalid id without touching the database", async () => {
    const response = await readRoute(
      postRequest("/api/notifications/not-a-uuid/read"),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(404);
    expect(state.readCalls).toHaveLength(0);
  });

  it("returns 404 when the row is missing or owned by someone else", async () => {
    state.readResult = null;

    const response = await readRoute(
      postRequest(`/api/notifications/${notificationId}/read`),
      context(notificationId),
    );

    expect(response.status).toBe(404);
    expect(state.readCalls).toEqual([{ recipientId: maya.id, id: notificationId }]);
  });

  it("marks the notification read for the session recipient", async () => {
    const response = await readRoute(
      postRequest(`/api/notifications/${notificationId}/read`),
      context(notificationId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: notificationId, readAt: "2026-05-01T10:00:00.000Z" },
    });
    expect(state.readCalls).toEqual([{ recipientId: maya.id, id: notificationId }]);
  });
});

describe("POST /api/notifications/read-all", () => {
  it("returns 401 without a session", async () => {
    state.session = null;

    const response = await readAllRoute(postRequest("/api/notifications/read-all"));

    expect(response.status).toBe(401);
    expect(state.readAllCalls).toHaveLength(0);
  });

  it("marks every unread row for the session recipient", async () => {
    const response = await readAllRoute(postRequest("/api/notifications/read-all"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { updated: 2 },
    });
    expect(state.readAllCalls).toEqual([{ recipientId: maya.id }]);
  });
});

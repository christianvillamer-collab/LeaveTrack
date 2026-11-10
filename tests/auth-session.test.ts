import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  providerUser: null as null | {
    email?: string | null;
    email_confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
    cookies?: Array<{ name: string; value: string }>;
  },
  providerError: null as null | { name: string; message: string },
  dbUser: null as null | {
    id: string;
    name: string;
    email: string;
    role: string;
    managerId: string | null;
  },
  lookupCount: 0,
  lookedUpEmail: null as string | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("session identity must never read cookies");
  },
}));

vi.mock("@/lib/auth/supabase", () => ({
  isAuthConfigured: () => state.configured,
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.providerUser },
        error: state.providerError,
      }),
    },
  }),
}));

vi.mock("@/lib/db/users", () => ({
  findUserByEmail: async (email: string) => {
    state.lookupCount += 1;
    state.lookedUpEmail = email;
    return state.dbUser;
  },
}));

import { getSession, requireRole, requireSession } from "@/lib/auth/session";

const linkedEmployee = {
  id: "user-1",
  name: "Maya Chen",
  email: "maya.chen@leavetrack.demo",
  role: "employee",
  managerId: "manager-1",
};

beforeEach(() => {
  state.configured = true;
  state.providerUser = {
    email: "maya.chen@leavetrack.demo",
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
  };
  state.providerError = null;
  state.dbUser = { ...linkedEmployee };
  state.lookupCount = 0;
  state.lookedUpEmail = null;
});

describe("getSession", () => {
  it("returns the id, role, and manager from the linked employee row", async () => {
    await expect(getSession()).resolves.toEqual({
      id: "user-1",
      role: "employee",
      name: "Maya Chen",
      email: "maya.chen@leavetrack.demo",
      managerId: "manager-1",
    });
    expect(state.lookedUpEmail).toBe("maya.chen@leavetrack.demo");
  });

  it("ignores provider role claims and never reads a forged role cookie", async () => {
    state.providerUser = {
      email: "maya.chen@leavetrack.demo",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      app_metadata: { role: "hr_admin" },
      user_metadata: { role: "hr_admin" },
      // A forged UI-hint cookie; getSession must not consult it.
      cookies: [{ name: "mock-role", value: "hr_admin" }],
    };

    const session = await getSession();

    expect(session).toMatchObject({ id: "user-1", role: "employee" });
  });

  it("treats a missing auth configuration as unauthenticated", async () => {
    state.configured = false;

    await expect(getSession()).resolves.toBeNull();
    expect(state.lookupCount).toBe(0);
  });

  it("returns null when the provider has no user", async () => {
    state.providerUser = null;

    await expect(getSession()).resolves.toBeNull();
    expect(state.lookupCount).toBe(0);
  });

  it("returns null even if a user is present when the provider reports an error", async () => {
    state.providerError = { name: "AuthError", message: "invalid token" };

    await expect(getSession()).resolves.toBeNull();
    expect(state.lookupCount).toBe(0);
  });

  it("requires a confirmed email", async () => {
    state.providerUser = {
      email: "maya.chen@leavetrack.demo",
      email_confirmed_at: null,
    };

    await expect(getSession()).resolves.toBeNull();
    expect(state.lookupCount).toBe(0);
  });

  it("requires the provider to expose an email", async () => {
    state.providerUser = { email: null, email_confirmed_at: "2026-01-01T00:00:00.000Z" };

    await expect(getSession()).resolves.toBeNull();
    expect(state.lookupCount).toBe(0);
  });

  it("returns null when no employee row is linked to the verified email", async () => {
    state.dbUser = null;

    await expect(getSession()).resolves.toBeNull();
    expect(state.lookupCount).toBe(1);
  });
});

describe("requireSession / requireRole", () => {
  it("redirects to /login without a session", async () => {
    state.providerUser = null;

    await expect(requireSession()).rejects.toThrow("redirect:/login");
  });

  it("redirects to /forbidden when the DB role is not allowed", async () => {
    await expect(requireRole(["hr_admin"])).rejects.toThrow("redirect:/forbidden");
  });

  it("returns the session when the DB role is allowed", async () => {
    await expect(requireRole(["employee", "manager"])).resolves.toMatchObject({
      role: "employee",
    });
  });
});

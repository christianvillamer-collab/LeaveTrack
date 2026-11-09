import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  scope: null as string | null,
  error: null as null | { name: string; message: string },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

vi.mock("@/lib/auth/supabase", () => ({
  isAuthConfigured: () => state.configured,
  createSupabaseServerClient: async () => ({
    auth: {
      signOut: async (options?: { scope?: string }) => {
        state.scope = options?.scope ?? null;
        return { error: state.error };
      },
    },
  }),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { signOut } from "@/app/(app)/actions";

beforeEach(() => {
  state.configured = true;
  state.scope = null;
  state.error = null;
});

describe("signOut", () => {
  it("signs out locally so cookies clear before the revoke request", async () => {
    await expect(signOut()).rejects.toThrow("redirect:/login");
    expect(state.scope).toBe("local");
  });

  it("still redirects when the provider revoke fails", async () => {
    state.error = { name: "AuthRetryableFetchError", message: "network down" };

    await expect(signOut()).rejects.toThrow("redirect:/login");
    expect(state.scope).toBe("local");
  });

  it("redirects without constructing a client when auth is unconfigured", async () => {
    state.configured = false;

    await expect(signOut()).rejects.toThrow("redirect:/login");
    expect(state.scope).toBeNull();
  });
});

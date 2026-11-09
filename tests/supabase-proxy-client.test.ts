import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const captured = vi.hoisted(() => ({
  options: null as unknown,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: unknown) => {
    captured.options = options;
    return {};
  },
}));

import { createSupabaseProxyClient } from "@/lib/auth/supabase";

interface CookieSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

interface ServerClientOptions {
  cookies: {
    setAll: (cookies: CookieSet[], headers: Record<string, string>) => void;
  };
}

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  captured.options = null;
});

afterAll(() => {
  if (originalUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  }

  if (originalKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
});

describe("createSupabaseProxyClient", () => {
  it("copies rotated cookies and the no-store headers onto the response", () => {
    const request = new NextRequest("http://localhost:3000/dashboard");
    const { response } = createSupabaseProxyClient(request);
    const options = captured.options as ServerClientOptions;

    options.cookies.setAll(
      [{ name: "sb-project-auth-token", value: "rotated", options: { path: "/" } }],
      { "Cache-Control": "no-store", "X-Supabase-Test": "1" },
    );

    const result = response();
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("x-supabase-test")).toBe("1");
    expect(result.cookies.get("sb-project-auth-token")?.value).toBe("rotated");
    expect(request.cookies.get("sb-project-auth-token")?.value).toBe("rotated");
  });
});

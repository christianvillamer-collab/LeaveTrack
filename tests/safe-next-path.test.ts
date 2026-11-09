import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/safe-next-path";

describe("safeNextPath", () => {
  it("accepts same-origin absolute paths", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/requests?status=pending")).toBe("/requests?status=pending");
  });

  it("rejects missing, absolute, and protocol-relative destinations", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("https://evil.example/x")).toBeNull();
    expect(safeNextPath("//evil.example/x")).toBeNull();
  });

  it("rejects a backslash, which browsers normalize into a protocol-relative path", () => {
    expect(safeNextPath("/\\evil.example/x")).toBeNull();
    expect(safeNextPath("/dashboard\\..\\evil")).toBeNull();
  });

  it("rejects control characters and a redirect back to /login", () => {
    expect(safeNextPath("/dashboard\nLocation: https://evil.example")).toBeNull();
    expect(safeNextPath("/login")).toBeNull();
  });
});

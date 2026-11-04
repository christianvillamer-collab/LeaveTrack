import { describe, expect, it } from "vitest";

import {
  countLeaveDays,
  formatDateRange,
  formatDays,
  formatRequestReference,
} from "@/lib/utils/format";

describe("countLeaveDays", () => {
  it("counts dates inclusively, matching the DB check", () => {
    expect(countLeaveDays("2026-11-16", "2026-11-16")).toBe(1);
    expect(countLeaveDays("2026-11-16", "2026-11-20")).toBe(5);
    expect(countLeaveDays("2026-11-30", "2026-12-02")).toBe(3);
  });
});

describe("formatDateRange", () => {
  it("collapses a single day", () => {
    expect(formatDateRange("2026-11-09", "2026-11-09")).toBe("9 Nov 2026");
  });

  it("collapses a same-month range", () => {
    expect(formatDateRange("2026-11-16", "2026-11-20")).toBe("16–20 Nov 2026");
  });

  it("keeps both months for a cross-month range", () => {
    expect(formatDateRange("2026-11-30", "2026-12-02")).toBe("30 Nov – 2 Dec 2026");
  });
});

describe("formatDays", () => {
  it("uses singular and fractional wording", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(2)).toBe("2 days");
    expect(formatDays(1.25)).toBe("1.25 days");
  });
});

describe("formatRequestReference", () => {
  it("derives a stable reference from a UUID", () => {
    expect(formatRequestReference("1f0c5e6a-9d2b-4a71-8c33-0b7f4e2d9a10")).toBe("LR-4E2D9A10");
  });

  it("does not depend on separators or casing", () => {
    expect(formatRequestReference("1F0C5E6A9D2B4A718C330B7F4E2D9A10")).toBe("LR-4E2D9A10");
  });

  it("keeps sequential seed UUIDs distinct", () => {
    expect(formatRequestReference("b0000000-0000-4000-8000-000000000001")).toBe("LR-00000001");
    expect(formatRequestReference("b0000000-0000-4000-8000-000000000002")).toBe("LR-00000002");
  });
});

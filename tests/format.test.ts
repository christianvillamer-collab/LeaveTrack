import { describe, expect, it } from "vitest";

import { countLeaveDays, formatDateRange, formatDays } from "@/lib/utils/format";

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

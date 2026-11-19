import { afterEach, describe, expect, it } from "vitest";

import {
  countLeaveDays,
  formatDateTime,
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

describe("formatDateTime", () => {
  const originalTimeZone = process.env.TZ;

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("renders instants in UTC regardless of the local timezone", () => {
    const instant = "2026-11-18T04:09:30.000Z";
    process.env.TZ = "Asia/Manila";
    expect(formatDateTime(instant)).toBe("18 Nov 2026, 04:09");
    process.env.TZ = "America/Los_Angeles";
    expect(formatDateTime(instant)).toBe("18 Nov 2026, 04:09");
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
  it("preserves a backfilled reference unchanged", () => {
    expect(formatRequestReference("LR-4E2D9A10")).toBe("LR-4E2D9A10");
    expect(formatRequestReference("LR-00000001")).toBe("LR-00000001");
  });

  it("preserves a sequence-generated reference unchanged", () => {
    expect(formatRequestReference("LR-0000ABCD")).toBe("LR-0000ABCD");
  });

  it("does not derive a reference from a request UUID", () => {
    const uuid = "1f0c5e6a-9d2b-4a71-8c33-0b7f4e2d9a10";
    expect(formatRequestReference(uuid)).toBe(uuid);
  });
});

import { describe, expect, it } from "vitest";

import { accrualPeriod, isAccrualPeriod } from "@/lib/domain/accrual";

describe("accrual periods", () => {
  it("normalizes any instant to its UTC month start", () => {
    expect(accrualPeriod(new Date("2026-11-04T15:30:00Z"))).toBe("2026-11-01");
    expect(accrualPeriod(new Date("2026-11-30T23:59:59.999Z"))).toBe("2026-11-01");
    expect(accrualPeriod(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12-01");
    expect(accrualPeriod(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
  });

  it("rolls over at UTC midnight, not at a local timezone boundary", () => {
    expect(accrualPeriod(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01");
    expect(accrualPeriod(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01");
  });

  it("accepts only first-of-month ISO dates", () => {
    expect(isAccrualPeriod("2026-11-01")).toBe(true);
    expect(isAccrualPeriod("2026-01-01")).toBe(true);
    expect(isAccrualPeriod("2026-11-02")).toBe(false);
    expect(isAccrualPeriod("2026-13-01")).toBe(false);
    expect(isAccrualPeriod("2026-11-1")).toBe(false);
    expect(isAccrualPeriod("2026-11-01T00:00:00Z")).toBe(false);
    expect(isAccrualPeriod("")).toBe(false);
  });
});

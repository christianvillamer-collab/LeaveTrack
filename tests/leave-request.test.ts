import { describe, expect, it } from "vitest";

import { evaluateBalanceWarning } from "@/lib/domain/leave";

describe("evaluateBalanceWarning", () => {
  it("warns when a tracked request exceeds the confirmed balance", () => {
    const warning = evaluateBalanceWarning({
      tracksBalance: true,
      requestedDays: 6,
      availableDays: 3.5,
    });

    expect(warning.exceedsBalance).toBe(true);
    expect(warning.requestedDays).toBe(6);
    expect(warning.availableDays).toBe(3.5);
    expect(warning.message).toContain("confirmed balance");
  });

  it("does not warn when the request fits the balance", () => {
    const warning = evaluateBalanceWarning({
      tracksBalance: true,
      requestedDays: 3,
      availableDays: 3,
    });

    expect(warning.exceedsBalance).toBe(false);
    expect(warning.message).toBeNull();
  });

  it("never warns for Unpaid leave", () => {
    const warning = evaluateBalanceWarning({
      tracksBalance: false,
      requestedDays: 99,
      availableDays: null,
    });

    expect(warning.exceedsBalance).toBe(false);
    expect(warning.availableDays).toBeNull();
    expect(warning.message).toBeNull();
  });

  it("treats a missing tracked balance as zero", () => {
    const warning = evaluateBalanceWarning({
      tracksBalance: true,
      requestedDays: 1,
      availableDays: null,
    });

    expect(warning.exceedsBalance).toBe(true);
    expect(warning.availableDays).toBe(0);
  });
});

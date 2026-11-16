import { describe, expect, it } from "vitest";

import {
  decisionInputSchema,
  leaveRequestInputSchema,
  leaveRequestScopeSchema,
  overrideInputSchema,
} from "@/lib/validation/leave";
import { policyRateInputSchema } from "@/lib/validation/policy";

const VACATION_ID = "11111111-1111-4111-8111-111111111111";
const SICK_ID = "22222222-2222-4222-8222-222222222222";

describe("leaveRequestInputSchema", () => {
  it("accepts an inclusive, well-formed request", () => {
    const result = leaveRequestInputSchema.safeParse({
      leaveTypeId: VACATION_ID,
      startDate: "2026-11-16",
      endDate: "2026-11-20",
      reason: "Family trip with a documented handover.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    const result = leaveRequestInputSchema.safeParse({
      leaveTypeId: VACATION_ID,
      startDate: "2026-11-20",
      endDate: "2026-11-16",
      reason: "Backwards dates should never reach the API.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["endDate"]);
    }
  });

  it("requires a reason of at least five characters", () => {
    const result = leaveRequestInputSchema.safeParse({
      leaveTypeId: SICK_ID,
      startDate: "2026-11-09",
      endDate: "2026-11-09",
      reason: "Flu",
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed dates", () => {
    const result = leaveRequestInputSchema.safeParse({
      leaveTypeId: SICK_ID,
      startDate: "16/11/2026",
      endDate: "2026-11-16",
      reason: "Wrong date format.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID leave type", () => {
    const result = leaveRequestInputSchema.safeParse({
      leaveTypeId: "lt-vacation",
      startDate: "2026-11-16",
      endDate: "2026-11-16",
      reason: "Legacy mock ids must not reach the DB.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown fields such as a client-supplied userId", () => {
    const result = leaveRequestInputSchema.safeParse({
      leaveTypeId: VACATION_ID,
      startDate: "2026-11-16",
      endDate: "2026-11-16",
      reason: "Attempting to submit for someone else.",
      userId: "00000000-0000-4000-8000-000000000000",
    });

    expect(result.success).toBe(false);
  });
});

describe("leaveRequestScopeSchema", () => {
  it("defaults omitted scope to mine", () => {
    expect(leaveRequestScopeSchema.parse(undefined)).toBe("mine");
  });

  it("accepts mine and team, and rejects unknown scopes", () => {
    expect(leaveRequestScopeSchema.safeParse("mine").success).toBe(true);
    expect(leaveRequestScopeSchema.safeParse("team").success).toBe(true);
    expect(leaveRequestScopeSchema.safeParse("all").success).toBe(false);
  });
});

describe("decisionInputSchema", () => {
  it("accepts approve without a reason", () => {
    expect(decisionInputSchema.safeParse({ decision: "approved" }).success).toBe(true);
  });

  it("requires a reason for rejection", () => {
    expect(decisionInputSchema.safeParse({ decision: "rejected" }).success).toBe(false);
    expect(
      decisionInputSchema.safeParse({
        decision: "rejected",
        reason: "Overlaps the pricing launch.",
      }).success,
    ).toBe(true);
  });

  it("only accepts approved or rejected", () => {
    expect(decisionInputSchema.safeParse({ decision: "pending" }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      decisionInputSchema.safeParse({
        decision: "approved",
        managerId: "a0000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });
});

describe("overrideInputSchema", () => {
  const valid = {
    override: true,
    decision: "approved",
    reason: "Balance reconciled with payroll.",
  };

  it("accepts an explicit override with a reason for approval", () => {
    expect(overrideInputSchema.safeParse(valid).success).toBe(true);
    expect(overrideInputSchema.safeParse({ ...valid, decision: "rejected" }).success).toBe(true);
  });

  it("requires the explicit override flag", () => {
    const missing = { decision: valid.decision, reason: valid.reason };
    expect(overrideInputSchema.safeParse(missing).success).toBe(false);
    expect(overrideInputSchema.safeParse({ ...valid, override: false }).success).toBe(false);
    expect(overrideInputSchema.safeParse({ ...valid, override: "true" }).success).toBe(false);
  });

  it("requires a reason of at least three characters for every decision", () => {
    expect(overrideInputSchema.safeParse({ ...valid, reason: "" }).success).toBe(false);
    expect(overrideInputSchema.safeParse({ ...valid, reason: "ok" }).success).toBe(false);
    expect(overrideInputSchema.safeParse({ ...valid, reason: "   " }).success).toBe(false);
  });

  it("only accepts approved or rejected and rejects unknown fields", () => {
    expect(overrideInputSchema.safeParse({ ...valid, decision: "pending" }).success).toBe(false);
    expect(
      overrideInputSchema.safeParse({
        ...valid,
        actorId: "a0000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });
});

describe("policyRateInputSchema", () => {
  const valid = {
    userId: "a0000000-0000-4000-8000-000000000004",
    leaveTypeId: VACATION_ID,
    accrualPerMonth: 1.5,
    effectiveFrom: "2027-01-01",
  };

  it("accepts an effective-dated rate", () => {
    expect(policyRateInputSchema.safeParse(valid).success).toBe(true);
  });

  it("requires an effective month start", () => {
    expect(policyRateInputSchema.safeParse({ ...valid, effectiveFrom: "2027-01-15" }).success).toBe(
      false,
    );
    expect(policyRateInputSchema.safeParse({ ...valid, effectiveFrom: "2027-01" }).success).toBe(
      false,
    );
  });

  it("rejects rates outside 0–31 and rates with more than two decimals", () => {
    expect(policyRateInputSchema.safeParse({ ...valid, accrualPerMonth: -1 }).success).toBe(false);
    expect(policyRateInputSchema.safeParse({ ...valid, accrualPerMonth: 32 }).success).toBe(false);
    expect(policyRateInputSchema.safeParse({ ...valid, accrualPerMonth: 1.255 }).success).toBe(
      false,
    );
    expect(policyRateInputSchema.safeParse({ ...valid, accrualPerMonth: "1.5" }).success).toBe(
      false,
    );
  });

  it("rejects non-UUID ids and client-supplied actor fields", () => {
    expect(policyRateInputSchema.safeParse({ ...valid, userId: "u-maya" }).success).toBe(false);
    expect(policyRateInputSchema.safeParse({ ...valid, leaveTypeId: "lt-vacation" }).success).toBe(
      false,
    );
    expect(
      policyRateInputSchema.safeParse({
        ...valid,
        actorId: "a0000000-0000-4000-8000-000000000003",
      }).success,
    ).toBe(false);
  });
});

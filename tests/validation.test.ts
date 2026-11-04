import { describe, expect, it } from "vitest";

import {
  decisionInputSchema,
  leaveRequestInputSchema,
  leaveRequestScopeSchema,
} from "@/lib/validation/leave";

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

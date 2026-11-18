import { describe, expect, it } from "vitest";

import { buildNotificationCopy } from "@/lib/notifications/templates";
import { notificationListLimitSchema } from "@/lib/validation/notifications";

const base = {
  employeeName: "Maya Chen",
  actorName: "Daniel Okafor",
  leaveTypeName: "Vacation",
  startDate: "2026-03-04",
  endDate: "2026-03-06",
  days: 3,
};

describe("buildNotificationCopy", () => {
  it("addresses a submission to the manager with the range and reason", () => {
    const copy = buildNotificationCopy({
      ...base,
      eventType: "request_submitted",
      reason: "Family trip",
    });

    expect(copy.subject).toBe("Maya Chen requested Vacation leave");
    expect(copy.body).toContain("4–6 Mar 2026");
    expect(copy.body).toContain("3 days");
    expect(copy.body).toContain("Reason: Family trip.");
  });

  it("omits the reason when the submitter gave none", () => {
    const copy = buildNotificationCopy({
      ...base,
      eventType: "request_submitted",
      reason: null,
    });

    expect(copy.body).not.toContain("Reason:");
  });

  it("tells the employee who approved and names the manager", () => {
    const copy = buildNotificationCopy({ ...base, eventType: "request_approved" });

    expect(copy.subject).toBe("Your Vacation request was approved");
    expect(copy.body).toContain("approved by Daniel Okafor");
  });

  it("includes the rejection reason", () => {
    const copy = buildNotificationCopy({
      ...base,
      eventType: "request_rejected",
      note: "Team is short-staffed",
    });

    expect(copy.subject).toBe("Your Vacation request was rejected");
    expect(copy.body).toContain("rejected by Daniel Okafor");
    expect(copy.body).toContain("Team is short-staffed.");
  });

  it("marks an HR override as such", () => {
    const copy = buildNotificationCopy({
      ...base,
      eventType: "request_approved",
      actorName: "Priya Nair",
      isOverride: true,
      note: "Balance correction",
    });

    expect(copy.body).toContain("HR (Priya Nair)");
    expect(copy.body).toContain("as an override");
    expect(copy.body).toContain("Balance correction.");
  });

  it("does not double a trailing period on a note", () => {
    const copy = buildNotificationCopy({
      ...base,
      eventType: "request_rejected",
      note: "Coverage gap.",
    });

    expect(copy.body).toContain("Coverage gap.");
    expect(copy.body).not.toContain("Coverage gap..");
  });
});

describe("notificationListLimitSchema", () => {
  it("defaults to 50 and accepts a value in range", () => {
    expect(notificationListLimitSchema.parse(undefined)).toBe(50);
    expect(notificationListLimitSchema.parse("")).toBe(50);
    expect(notificationListLimitSchema.parse("10")).toBe(10);
    expect(notificationListLimitSchema.parse("100")).toBe(100);
  });

  it("rejects non-numeric, fractional, and out-of-range values", () => {
    for (const value of ["abc", "0", "101", "1.5", "-3"]) {
      expect(() => notificationListLimitSchema.parse(value), value).toThrow();
    }
  });
});

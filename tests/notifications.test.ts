import { describe, expect, it } from "vitest";

import { buildNotificationEmail } from "@/lib/notifications/email-template";
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

describe("buildNotificationEmail", () => {
  it("reuses the shared copy for subject and text", () => {
    const input = { ...base, eventType: "request_approved" as const };
    const email = buildNotificationEmail(input);

    expect(email.subject).toBe(buildNotificationCopy(input).subject);
    expect(email.body).toBe(buildNotificationCopy(input).body);
    expect(email.body).toContain("approved by Daniel Okafor");
  });

  it("designs a pending submission for the manager queue", () => {
    const html = buildNotificationEmail({
      ...base,
      eventType: "request_submitted",
      reason: "Family trip",
    }).html;

    expect(html).toContain("PENDING REVIEW");
    expect(html).toContain("Review request");
    expect(html).toContain("/approvals");
    expect(html).toContain("Family trip");
    expect(html).toContain("4–6 Mar 2026");
  });

  it("links approved and rejected decisions to the requestor inbox", () => {
    for (const eventType of ["request_approved", "request_rejected"] as const) {
      const html = buildNotificationEmail({ ...base, eventType }).html;

      expect(html).toContain("View your request");
      expect(html).toContain("/requests");
      expect(html).not.toContain("/approvals");
    }
  });

  it("uses a distinct status banner for each event", () => {
    const pending = buildNotificationEmail({ ...base, eventType: "request_submitted" }).html;
    const approved = buildNotificationEmail({ ...base, eventType: "request_approved" }).html;
    const rejected = buildNotificationEmail({ ...base, eventType: "request_rejected" }).html;

    expect(pending).toContain("#c4700c");
    expect(approved).toContain("#208455");
    expect(rejected).toContain("#c52828");
  });

  it("escapes user-provided copy in the HTML body", () => {
    const html = buildNotificationEmail({
      ...base,
      eventType: "request_rejected",
      note: '<script>alert("x")</script>',
    }).html;

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;x&quot;");
  });

  it("labels an HR override reason as an override rather than a manager note", () => {
    const html = buildNotificationEmail({
      ...base,
      eventType: "request_approved",
      actorName: "Priya Nair",
      note: "Balance correction",
      isOverride: true,
    }).html;

    expect(html).toContain("HR override reason");
    expect(html).toContain("Balance correction");
    expect(html).not.toContain("Manager note");
    expect(html).toContain("approved by HR (Priya Nair) as an override");
  });

  it("keeps a maximum-length escaped note inside the outbox HTML limit", () => {
    const note = `"${"&".repeat(1998)}"`;
    const html = buildNotificationEmail({
      ...base,
      eventType: "request_rejected",
      note,
    }).html;

    expect(html.length).toBeLessThan(100000);
    expect(html).toContain("&amp;".repeat(1998));
  });

  it("truncates the hidden preheader without changing the visible copy", () => {
    const note = "Coverage confirmed with the client.".repeat(5);
    const email = buildNotificationEmail({
      ...base,
      eventType: "request_rejected",
      note,
    });

    expect(email.body).toContain(note);
    expect(email.html).toContain("…");
    expect(email.html.indexOf("…")).toBeLessThan(
      email.html.indexOf(`<p style="margin:0;color:#1c2430`),
    );
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

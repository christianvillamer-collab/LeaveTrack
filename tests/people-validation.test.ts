import { describe, expect, it } from "vitest";

import {
  managerAssignmentSchema,
  peopleImportSchema,
  personIdSchema,
  personProfileSchema,
  personStatusSchema,
} from "@/lib/validation/people";

const personId = "a0000000-0000-4000-8000-000000000004";

describe("personProfileSchema", () => {
  it("trims text and turns empty directory fields into null", () => {
    const parsed = personProfileSchema.parse({
      name: "  Maya Chen  ",
      email: "  maya.chen@leavetrack.demo ",
      jobTitle: "   ",
      team: "",
    });

    expect(parsed).toEqual({
      name: "Maya Chen",
      email: "maya.chen@leavetrack.demo",
      jobTitle: null,
      team: null,
    });
  });

  it("rejects an empty name, an invalid email, and unknown keys", () => {
    expect(
      personProfileSchema.safeParse({
        name: " ",
        email: "maya.chen@leavetrack.demo",
        jobTitle: null,
        team: null,
      }).success,
    ).toBe(false);

    expect(
      personProfileSchema.safeParse({
        name: "Maya Chen",
        email: "not-an-email",
        jobTitle: null,
        team: null,
      }).success,
    ).toBe(false);

    expect(
      personProfileSchema.safeParse({
        name: "Maya Chen",
        email: "maya.chen@leavetrack.demo",
        jobTitle: null,
        team: null,
        role: "hr_admin",
      }).success,
    ).toBe(false);
  });

  it("caps the name and directory fields at 120 characters", () => {
    expect(
      personProfileSchema.safeParse({
        name: "a".repeat(121),
        email: "maya.chen@leavetrack.demo",
        jobTitle: null,
        team: null,
      }).success,
    ).toBe(false);

    expect(
      personProfileSchema.safeParse({
        name: "Maya Chen",
        email: "maya.chen@leavetrack.demo",
        jobTitle: "a".repeat(121),
        team: null,
      }).success,
    ).toBe(false);
  });
});

describe("managerAssignmentSchema", () => {
  it("accepts a manager uuid or null", () => {
    expect(managerAssignmentSchema.parse({ managerId: personId }).managerId).toBe(personId);
    expect(managerAssignmentSchema.parse({ managerId: null }).managerId).toBeNull();
  });

  it("rejects a non-uuid manager", () => {
    expect(managerAssignmentSchema.safeParse({ managerId: "daniel" }).success).toBe(false);
  });
});

describe("personStatusSchema", () => {
  it("requires a reason of at least three characters to deactivate", () => {
    expect(personStatusSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(personStatusSchema.safeParse({ isActive: false, reason: "no" }).success).toBe(false);
    expect(
      personStatusSchema.safeParse({ isActive: false, reason: "Left the company" }).success,
    ).toBe(true);
  });

  it("does not require a reason to reactivate", () => {
    expect(personStatusSchema.safeParse({ isActive: true }).success).toBe(true);
  });

  it("caps the reason at 2000 characters", () => {
    expect(
      personStatusSchema.safeParse({ isActive: false, reason: "a".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("peopleImportSchema", () => {
  it("keeps omitted optional fields undefined so import can leave them alone", () => {
    const [row] = peopleImportSchema.parse([
      {
        name: "Alex Rivera",
        email: "alex.rivera@leavetrack.demo",
        managerEmail: "daniel.okafor@leavetrack.demo",
        jobTitle: "",
      },
    ]);

    expect(row).toMatchObject({
      name: "Alex Rivera",
      email: "alex.rivera@leavetrack.demo",
      managerEmail: "daniel.okafor@leavetrack.demo",
      jobTitle: null,
    });
    // Omitted is not the same as cleared.
    expect(row.team).toBeUndefined();
  });

  it("distinguishes an omitted field from an explicit null", () => {
    const [omitted] = peopleImportSchema.parse([
      { name: "Alex Rivera", email: "alex.rivera@leavetrack.demo" },
    ]);
    const [cleared] = peopleImportSchema.parse([
      { name: "Alex Rivera", email: "alex.rivera@leavetrack.demo", team: null },
    ]);

    expect(omitted.managerEmail).toBeUndefined();
    expect(omitted.jobTitle).toBeUndefined();
    expect(omitted.team).toBeUndefined();
    expect(cleared.team).toBeNull();
  });

  it("rejects duplicate emails in one batch, case-insensitively", () => {
    const result = peopleImportSchema.safeParse([
      { name: "Alex Rivera", email: "alex.rivera@leavetrack.demo" },
      { name: "Alex Again", email: "ALEX.RIVERA@leavetrack.demo" },
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("more than once");
    }
  });

  it("rejects an empty batch and more than 200 rows", () => {
    expect(peopleImportSchema.safeParse([]).success).toBe(false);

    const rows = Array.from({ length: 201 }, (_, index) => ({
      name: `Person ${index}`,
      email: `person.${index}@leavetrack.demo`,
    }));

    expect(peopleImportSchema.safeParse(rows).success).toBe(false);
  });

  it("rejects an unknown role and unknown keys", () => {
    expect(
      peopleImportSchema.safeParse([
        {
          name: "Alex Rivera",
          email: "alex.rivera@leavetrack.demo",
          role: "owner",
        },
      ]).success,
    ).toBe(false);

    expect(
      peopleImportSchema.safeParse([
        {
          name: "Alex Rivera",
          email: "alex.rivera@leavetrack.demo",
          password: "secret",
        },
      ]).success,
    ).toBe(false);
  });
});

describe("personIdSchema", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(personIdSchema.safeParse(personId).success).toBe(true);
    expect(personIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(personIdSchema.safeParse(undefined).success).toBe(false);
  });
});

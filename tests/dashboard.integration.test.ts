import { afterAll, describe, expect, it } from "vitest";

import { getAccrualSummary } from "@/lib/db/accrual";
import { countAuditEvents, listRecentAuditEvents } from "@/lib/db/audit";
import { getDb } from "@/lib/db/client";
import { getMyLeaveData, getTeamLeaveData } from "@/lib/db/leave";
import { listPolicyOverview } from "@/lib/db/policies";
import { findUserByEmail, listDirectory } from "@/lib/db/users";
import { formatRequestReference } from "@/lib/utils/format";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Test periods live in 2399 so they sort after any real or seeded accrual row. */
async function clearTestLedger(): Promise<void> {
  await getDb()`
    delete from accrual_ledger
    where period >= '2399-01-01'
      and period < '2400-01-01'
  `;
}

describe.skipIf(!hasDatabase)("dashboard data", () => {
  afterAll(async () => {
    if (hasDatabase) {
      await clearTestLedger();
      await getDb().end({ timeout: 5 });
    }
  });

  it("reports the latest accrual period, run time, and people processed", async () => {
    const maya = await findUserByEmail("maya.chen@leavetrack.demo");
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");

    expect(maya).not.toBeNull();
    expect(daniel).not.toBeNull();

    if (!maya || !daniel) {
      return;
    }

    const [vacation] = await getDb()<{ id: string }[]>`
      select id from leave_types where name = 'Vacation' limit 1
    `;

    if (!vacation) {
      throw new Error("Seed leave types are missing; run npm run db:seed.");
    }

    await clearTestLedger();

    // Two people in April, one person in May: the latest period has one person.
    await getDb()`
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      values
        (${maya.id}, ${vacation.id}, '2399-04-01', 1),
        (${daniel.id}, ${vacation.id}, '2399-04-01', 1),
        (${maya.id}, ${vacation.id}, '2399-05-01', 1)
    `;

    try {
      const summary = await getAccrualSummary();

      expect(summary.lastPeriod).toBe("2399-05-01");
      expect(summary.nextRunAt).toBe("2399-06-01");
      expect(summary.peopleProcessed).toBe(1);
      expect(summary.lastRunAt).not.toBeNull();
    } finally {
      await clearTestLedger();
    }
  });

  it("rolls the next run into January of the following year", async () => {
    const maya = await findUserByEmail("maya.chen@leavetrack.demo");
    expect(maya).not.toBeNull();

    if (!maya) {
      return;
    }

    const [vacation] = await getDb()<{ id: string }[]>`
      select id from leave_types where name = 'Vacation' limit 1
    `;

    if (!vacation) {
      throw new Error("Seed leave types are missing; run npm run db:seed.");
    }

    await clearTestLedger();

    await getDb()`
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      values (${maya.id}, ${vacation.id}, '2399-12-01', 1)
    `;

    try {
      const summary = await getAccrualSummary();

      expect(summary.lastPeriod).toBe("2399-12-01");
      expect(summary.nextRunAt).toBe("2400-01-01");
    } finally {
      await clearTestLedger();
    }
  });

  it("groups the policy snapshot by leave type with assigned headcount", async () => {
    const policies = await listPolicyOverview();

    expect(policies.map((policy) => policy.leaveType.name)).toEqual(["Vacation", "Sick", "Unpaid"]);

    const vacation = policies[0];
    const unpaid = policies[2];

    expect(vacation?.accrualPerMonth).toBe(1.25);
    expect(vacation?.assignedEmployees).toBe(10);
    expect(unpaid?.leaveType.tracksBalance).toBe(false);
    expect(unpaid?.assignedEmployees).toBe(0);
  });

  it("resolves each directory entry's manager name in SQL", async () => {
    const directory = await listDirectory();

    expect(directory.length).toBeGreaterThanOrEqual(10);

    const maya = directory.find((entry) => entry.name === "Maya Chen");
    const daniel = directory.find((entry) => entry.name === "Daniel Okafor");

    expect(maya?.managerName).toBe("Daniel Okafor");
    expect(daniel?.managerName).toBeNull();
    expect(daniel?.managerId).toBeNull();
  });

  it("counts audit events and returns the newest first", async () => {
    const total = await countAuditEvents();
    const recent = await listRecentAuditEvents(3);

    expect(total).toBeGreaterThanOrEqual(8);
    expect(recent).toHaveLength(3);

    const [first, second, third] = recent;

    if (!first || !second || !third) {
      throw new Error("Expected three recent audit events.");
    }

    expect(first.occurredAt >= second.occurredAt).toBe(true);
    expect(second.occurredAt >= third.occurredAt).toBe(true);
  });

  it("puts a stable reference on every own and team request", async () => {
    const maya = await findUserByEmail("maya.chen@leavetrack.demo");
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");

    expect(maya).not.toBeNull();
    expect(daniel).not.toBeNull();

    if (!maya || !daniel) {
      return;
    }

    const mine = await getMyLeaveData(maya.id);
    const team = await getTeamLeaveData(daniel.id);

    expect(mine.requests.length).toBeGreaterThan(0);
    expect(team.requests.length).toBeGreaterThan(0);

    for (const request of [...mine.requests, ...team.requests]) {
      expect(request.reference).toBe(formatRequestReference(request.id));
    }
  });
});

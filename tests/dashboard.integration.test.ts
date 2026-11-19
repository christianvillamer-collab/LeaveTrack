import { afterAll, describe, expect, it } from "vitest";

import { getAccrualSummary } from "@/lib/db/accrual";
import { countAuditEvents, listRecentAuditEvents } from "@/lib/db/audit";
import { getDb } from "@/lib/db/client";
import { getMyLeaveData, getTeamLeaveData } from "@/lib/db/leave";
import { listPolicyOverview } from "@/lib/db/policies";
import { findUserByEmail, listDirectory } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);

function addMonth(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

/** Ledger rows are append-only (E2-17), so test rows always follow the max period. */
async function nextLedgerPeriod(): Promise<string> {
  const [row] = await getDb()<{ period: string | null }[]>`
    select max(period)::text as period from accrual_ledger
  `;

  return addMonth(row?.period ?? "8998-12-01");
}

/** A December strictly after the max period exercises the January rollover. */
async function nextDecemberPeriod(): Promise<string> {
  const [row] = await getDb()<{ period: string | null }[]>`
    select max(period)::text as period from accrual_ledger
  `;

  const year = Number((row?.period ?? "8998-12-01").slice(0, 4)) + 1;
  return `${year}-12-01`;
}

describe.skipIf(!hasDatabase)("dashboard data", () => {
  afterAll(async () => {
    if (hasDatabase) {
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

    const firstPeriod = await nextLedgerPeriod();
    const lastPeriod = addMonth(firstPeriod);

    // Two people in the earlier period, one in the latest: one person processed.
    await getDb()`
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      values
        (${maya.id}, ${vacation.id}, ${firstPeriod}::date, 1),
        (${daniel.id}, ${vacation.id}, ${firstPeriod}::date, 1),
        (${maya.id}, ${vacation.id}, ${lastPeriod}::date, 1)
      on conflict (user_id, leave_type_id, period) do nothing
    `;

    const summary = await getAccrualSummary();

    expect(summary.lastPeriod).toBe(lastPeriod);
    expect(summary.nextRunAt).toBe(addMonth(lastPeriod));
    expect(summary.peopleProcessed).toBe(1);
    expect(summary.lastRunAt).not.toBeNull();
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

    const decemberPeriod = await nextDecemberPeriod();
    const nextYear = Number(decemberPeriod.slice(0, 4)) + 1;

    await getDb()`
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      values (${maya.id}, ${vacation.id}, ${decemberPeriod}::date, 1)
      on conflict (user_id, leave_type_id, period) do nothing
    `;

    const summary = await getAccrualSummary();

    expect(summary.lastPeriod).toBe(decemberPeriod);
    expect(summary.nextRunAt).toBe(`${nextYear}-01-01`);
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
    const requests = [...mine.requests, ...team.requests];

    expect(mine.requests.length).toBeGreaterThan(0);
    expect(team.requests.length).toBeGreaterThan(0);

    const rows = await getDb()<{ id: string; reference: string }[]>`
      select id, reference from leave_requests where id = any(${requests.map((r) => r.id)}::uuid[])
    `;
    const stored = new Map(rows.map((row) => [row.id, row.reference]));

    for (const request of requests) {
      expect(request.reference).toBe(stored.get(request.id));
      expect(request.reference).toMatch(/^LR-[0-9A-F]{8}$/);
    }
  });
});

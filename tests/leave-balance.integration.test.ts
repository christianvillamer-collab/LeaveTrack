import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { getBalancesForUser, getMyLeaveData } from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Ledger rows are append-only (E2-17), so test rows always follow the max period. */
async function nextLedgerPeriod(): Promise<string> {
  const [row] = await getDb()<{ period: string | null }[]>`
    select max(period)::text as period from accrual_ledger
  `;
  const [year, month] = (row?.period ?? "8998-12-01").split("-").map(Number);

  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function addMonth(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

describe.skipIf(!hasDatabase)("leave balance data", () => {
  afterAll(async () => {
    if (hasDatabase) {
      await getDb().end({ timeout: 5 });
    }
  });

  it("returns confirmed and pending amounts separately per leave type", async () => {
    const user = await findUserByEmail("maya.chen@leavetrack.demo");
    expect(user).not.toBeNull();

    if (!user) {
      return;
    }

    const balances = await getBalancesForUser(user.id);
    const vacation = balances.find((balance) => balance.leaveType.name === "Vacation");
    const sick = balances.find((balance) => balance.leaveType.name === "Sick");
    const unpaid = balances.find((balance) => balance.leaveType.name === "Unpaid");

    if (!vacation || !sick || !unpaid) {
      throw new Error("Seed leave types are missing from the balance query.");
    }

    expect(vacation.confirmed).toBe(12.5);
    expect(vacation.pending).toBe(5);
    expect(sick.confirmed).toBe(8);
    expect(sick.pending).toBe(0);
    expect(unpaid.confirmed).toBeNull();

    const [accrual] = await getDb()<{ last_accrued_at: Date | null }[]>`
      select max(created_at) as last_accrued_at
      from accrual_ledger
      where user_id = ${user.id}
        and leave_type_id = ${vacation.leaveType.id}
    `;

    expect(vacation.lastAccruedAt).toBe(accrual?.last_accrued_at?.toISOString() ?? null);
    expect(unpaid.lastAccruedAt).toBeNull();
  });

  it("takes this user's newest ledger row only", async () => {
    const user = await findUserByEmail("maya.chen@leavetrack.demo");
    const other = await findUserByEmail("daniel.okafor@leavetrack.demo");
    expect(user).not.toBeNull();
    expect(other).not.toBeNull();

    if (!user || !other) {
      return;
    }

    const [vacationType] = await getDb()<{ id: string }[]>`
      select id
      from leave_types
      where name = 'Vacation'
      limit 1
    `;

    if (!vacationType) {
      throw new Error("Seed leave types are missing; run npm run db:seed.");
    }

    const firstPeriod = await nextLedgerPeriod();
    const secondPeriod = addMonth(firstPeriod);
    const otherPeriod = addMonth(secondPeriod);

    await getDb()`
      insert into accrual_ledger (user_id, leave_type_id, period, days, created_at)
      values
        (
          ${user.id}, ${vacationType.id}, ${firstPeriod}::date, 0.01,
          (${firstPeriod}::date + time '00:00:00') at time zone 'UTC'
        ),
        (
          ${user.id}, ${vacationType.id}, ${secondPeriod}::date, 0.01,
          (${secondPeriod}::date + time '00:00:00') at time zone 'UTC'
        ),
        (
          ${other.id}, ${vacationType.id}, ${otherPeriod}::date, 0.01,
          (${otherPeriod}::date + time '00:00:00') at time zone 'UTC'
        )
      on conflict (user_id, leave_type_id, period) do nothing
    `;

    const balances = await getBalancesForUser(user.id);
    const vacation = balances.find((balance) => balance.leaveType.id === vacationType.id);

    // The second row is this user's newest: `min` would return the first, and
    // dropping the user predicate would return the other user's later row.
    expect(vacation?.lastAccruedAt).toBe(`${secondPeriod}T00:00:00.000Z`);
  });

  it("returns active own requests and lets the page filter pending", async () => {
    const user = await findUserByEmail("maya.chen@leavetrack.demo");
    expect(user).not.toBeNull();

    if (!user) {
      return;
    }

    const data = await getMyLeaveData(user.id);
    const pending = data.requests.filter((request) => request.status === "pending");

    expect(data.balances).toHaveLength(3);
    expect(data.requests).toHaveLength(3);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.days).toBe(5);
    expect(pending[0]?.startDate).toBe("2026-11-16");
    expect(pending[0]?.endDate).toBe("2026-11-20");
    expect(data.requests.every((request) => request.createdAt.length > 0)).toBe(true);
  });
});

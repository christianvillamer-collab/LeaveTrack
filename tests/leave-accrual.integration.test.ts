import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAccrual } from "@/lib/db/accrual";
import { getDb } from "@/lib/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);

interface PolicyRow {
  user_id: string;
  leave_type_id: string;
  accrual_per_month: string;
}

interface BalanceRow {
  user_id: string;
  leave_type_id: string;
  balance: string;
}

const key = (userId: string, leaveTypeId: string) => `${userId}:${leaveTypeId}`;

describe.skipIf(!hasDatabase)("monthly accrual", () => {
  // A far-future month keeps the test independent of real accrual history and
  // of the `updated_at` values the rest of the suite relies on.
  const period = `${2400 + Math.floor(Math.random() * 100)}-01-01`;

  let policies: PolicyRow[] = [];
  let balancesBefore = new Map<string, string>();

  async function snapshotBalances(): Promise<Map<string, string>> {
    const rows = await getDb()<BalanceRow[]>`
      select user_id, leave_type_id, balance
      from leave_balances
    `;

    return new Map(rows.map((row) => [key(row.user_id, row.leave_type_id), row.balance]));
  }

  async function ledgerCount(): Promise<number> {
    const rows = await getDb()<{ count: number }[]>`
      select count(*)::int as count
      from accrual_ledger
      where period = ${period}::date
    `;

    return rows[0]?.count ?? 0;
  }

  beforeAll(async () => {
    policies = await getDb()<PolicyRow[]>`
      select p.user_id, p.leave_type_id, p.accrual_per_month
      from leave_policies p
      join leave_types t on t.id = p.leave_type_id
      where t.tracks_balance = true
        and p.accrual_per_month > 0
    `;

    if (policies.length === 0) {
      throw new Error("Seed leave policies are missing; run npm run db:seed.");
    }

    balancesBefore = await snapshotBalances();
  });

  afterAll(async () => {
    if (!hasDatabase) {
      return;
    }

    for (const [pair, balance] of balancesBefore) {
      const [userId, leaveTypeId] = pair.split(":");

      await getDb()`
        update leave_balances
        set balance = ${Number(balance)}
        where user_id = ${userId}
          and leave_type_id = ${leaveTypeId}
      `;
    }

    await getDb()`
      delete from accrual_ledger
      where period = ${period}::date
    `;

    await getDb().end({ timeout: 5 });
  });

  it("credits every tracked policy exactly once (AC1)", async () => {
    const result = await runAccrual(period);

    expect(result.period).toBe(period);
    expect(result.balancesAccrued).toBe(policies.length);
    expect(result.usersAccrued).toBe(new Set(policies.map((policy) => policy.user_id)).size);
    expect(result.totalDays).toBeCloseTo(
      policies.reduce((sum, policy) => sum + Number(policy.accrual_per_month), 0),
      2,
    );
    expect(await ledgerCount()).toBe(policies.length);

    const balancesAfter = await snapshotBalances();

    for (const policy of policies) {
      const pair = key(policy.user_id, policy.leave_type_id);
      const before = Number(balancesBefore.get(pair) ?? 0);
      const after = Number(balancesAfter.get(pair) ?? 0);

      expect(after - before).toBeCloseTo(Number(policy.accrual_per_month), 2);
    }

    const untracked = await getDb()<{ count: number }[]>`
      select count(*)::int as count
      from leave_balances b
      join leave_types t on t.id = b.leave_type_id
      where t.tracks_balance = false
    `;
    expect(untracked[0]?.count).toBe(0);
  });

  it("does not accrue twice for the same month (AC2)", async () => {
    const balancesBeforeRerun = await snapshotBalances();
    const ledgerBeforeRerun = await ledgerCount();

    const result = await runAccrual(period);

    expect(result).toEqual({
      period,
      usersAccrued: 0,
      balancesAccrued: 0,
      totalDays: 0,
    });
    expect(await snapshotBalances()).toEqual(balancesBeforeRerun);
    expect(await ledgerCount()).toBe(ledgerBeforeRerun);
  });

  it("rejects a period that is not the first day of a month", async () => {
    await expect(runAccrual("2026-11-02")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

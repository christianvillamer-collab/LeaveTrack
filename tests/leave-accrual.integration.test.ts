import { randomInt } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAccrual } from "@/lib/db/accrual";
import { getDb } from "@/lib/db/client";
import { getBalancesForUser } from "@/lib/db/leave";
import { upsertPolicyRate } from "@/lib/db/policies";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const MAYA_ID = "a0000000-0000-4000-8000-000000000004";
const PRIYA_ID = "a0000000-0000-4000-8000-000000000003";
const VACATION_ID = "11111111-1111-4111-8111-111111111111";

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
  // Far-future, run-unique months keep the suite independent of real history.
  // Ledger rows are append-only (E2-17), so they are never deleted in cleanup.
  // Random year/month avoids collisions between two runs in the same second.
  const baseYear = 2400 + randomInt(0, 2000);
  const month = randomInt(1, 13);
  const monthText = String(month).padStart(2, "0");
  const nextMonthYear = month === 12 ? baseYear + 501 : baseYear + 500;
  const nextMonthText = String(month === 12 ? 1 : month + 1).padStart(2, "0");
  const period = `${baseYear}-${monthText}-01`;
  const effectivePrePeriod = `${baseYear + 500}-${monthText}-01`;
  const effectivePostPeriod = `${nextMonthYear}-${nextMonthText}-01`;
  const inactivePeriod = `${baseYear + 600}-${monthText}-01`;
  const guardPeriod = `${baseYear + 700}-${monthText}-01`;

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
      select distinct on (p.user_id, p.leave_type_id)
        p.user_id,
        p.leave_type_id,
        p.accrual_per_month
      from leave_policies p
      join leave_types t on t.id = p.leave_type_id
      where t.tracks_balance = true
        and p.effective_from <= ${period}::date
      order by p.user_id, p.leave_type_id, p.effective_from desc
    `;

    policies = policies.filter((policy) => Number(policy.accrual_per_month) > 0);

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

    const sample = policies[0];

    if (sample) {
      const balances = await getBalancesForUser(sample.user_id);
      const balance = balances.find((item) => item.leaveType.id === sample.leave_type_id);
      const [ledger] = await getDb()<{ created_at: Date }[]>`
        select max(created_at) as created_at
        from accrual_ledger
        where user_id = ${sample.user_id}
          and leave_type_id = ${sample.leave_type_id}
      `;

      if (!balance || !ledger?.created_at) {
        throw new Error("The accrual run did not produce a readable ledger balance.");
      }

      // Append-only rows from other suites may be newer, so the read must track
      // the ledger's max(created_at), not assume this run's row is the latest.
      expect(balance.lastAccruedAt).toBe(ledger.created_at.toISOString());
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

  it("blocks ledger deletion and updates", async () => {
    const [inserted] = await getDb()<{ id: string }[]>`
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      values (${MAYA_ID}, ${VACATION_ID}, ${guardPeriod}::date, 1)
      on conflict (user_id, leave_type_id, period) do nothing
      returning id
    `;

    const id = inserted?.id;
    expect(id).toBeTruthy();

    if (!id) {
      throw new Error("The guard-period ledger row was not inserted.");
    }

    await expect(getDb()`
      delete from accrual_ledger
      where id = ${id}
    `).rejects.toThrow(/append-only/);

    await expect(getDb()`
      update accrual_ledger
      set days = 2
      where id = ${id}
    `).rejects.toThrow(/append-only/);
  });

  it("uses the rate effective for the run period, not today's rate (AC4)", async () => {
    const prePeriod = effectivePrePeriod;
    const postPeriod = effectivePostPeriod;
    const newRate = 2.5;
    const pair = key(MAYA_ID, VACATION_ID);
    const before = await snapshotBalances();

    const [previous] = await getDb()<{ accrual_per_month: string }[]>`
      select accrual_per_month
      from leave_policies
      where user_id = ${MAYA_ID}
        and leave_type_id = ${VACATION_ID}
        and effective_from <= ${prePeriod}::date
      order by effective_from desc
      limit 1
    `;

    if (!previous) {
      throw new Error("The seeded Vacation policy is missing; run npm run db:seed.");
    }

    const previousRate = Number(previous.accrual_per_month);
    expect(previousRate).toBeLessThan(newRate);

    try {
      const saved = await upsertPolicyRate({
        actorId: PRIYA_ID,
        userId: MAYA_ID,
        leaveTypeId: VACATION_ID,
        accrualPerMonth: newRate,
        effectiveFrom: postPeriod,
      });

      expect(saved.auditWritten).toBe(true);

      await runAccrual(prePeriod);
      const afterPre = await snapshotBalances();
      expect(Number(afterPre.get(pair) ?? 0) - Number(before.get(pair) ?? 0)).toBeCloseTo(
        previousRate,
        2,
      );

      await runAccrual(postPeriod);
      const afterPost = await snapshotBalances();
      expect(Number(afterPost.get(pair) ?? 0) - Number(afterPre.get(pair) ?? 0)).toBeCloseTo(
        newRate,
        2,
      );
    } finally {
      for (const [pairKey, balance] of before) {
        const [userId, leaveTypeId] = pairKey.split(":");

        await getDb()`
          update leave_balances
          set balance = ${Number(balance)}
          where user_id = ${userId}
            and leave_type_id = ${leaveTypeId}
        `;
      }

      await getDb()`
        delete from leave_policies
        where user_id = ${MAYA_ID}
          and leave_type_id = ${VACATION_ID}
          and effective_from = ${postPeriod}::date
      `;
    }
  });

  it("does not accrue for a deactivated person", async () => {
    const before = await snapshotBalances();

    await getDb()`
      update users
      set is_active = false,
          deactivated_at = now()
      where id = ${MAYA_ID}
    `;

    try {
      await runAccrual(inactivePeriod);

      const [maya] = await getDb()<{ count: number }[]>`
        select count(*)::int as count
        from accrual_ledger
        where user_id = ${MAYA_ID}
          and period = ${inactivePeriod}::date
      `;
      expect(maya.count).toBe(0);

      const after = await snapshotBalances();

      for (const [pair, balance] of before) {
        const [userId] = pair.split(":");

        if (userId === MAYA_ID) {
          expect(after.get(pair)).toBe(balance);
        }
      }

      // Prove the run itself happened; only the inactive person is skipped.
      const [active] = await getDb()<{ count: number }[]>`
        select count(*)::int as count
        from accrual_ledger
        where period = ${inactivePeriod}::date
          and user_id <> ${MAYA_ID}
      `;
      expect(active.count).toBeGreaterThan(0);
    } finally {
      await getDb()`
        update users
        set is_active = true,
            deactivated_at = null
        where id = ${MAYA_ID}
      `;

      for (const [pair, balance] of before) {
        const [userId, leaveTypeId] = pair.split(":");

        await getDb()`
          update leave_balances
          set balance = ${Number(balance)}
          where user_id = ${userId}
            and leave_type_id = ${leaveTypeId}
        `;
      }
    }
  });

  it("rejects a period that is not the first day of a month", async () => {
    await expect(runAccrual("2026-11-02")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

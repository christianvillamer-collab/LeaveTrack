import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { listPolicyChangeLog, upsertPolicyRate } from "@/lib/db/policies";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const MAYA_ID = "a0000000-0000-4000-8000-000000000004";
const PRIYA_ID = "a0000000-0000-4000-8000-000000000003";
const VACATION_ID = "11111111-1111-4111-8111-111111111111";
const UNPAID_ID = "33333333-3333-4333-8333-333333333333";

// A far-future effective month keeps the test independent of real policy
// history. The wide range makes a collision with a previous run negligible.
const effectiveFrom = `${2600 + Math.floor(Math.random() * 7000)}-01-01`;

interface AuditRow {
  previous_rate: string | null;
  new_rate: string;
  actor_id: string;
}

async function auditRows(): Promise<AuditRow[]> {
  return getDb()<AuditRow[]>`
    select previous_rate, new_rate, actor_id
    from policy_audit_log
    where user_id = ${MAYA_ID}
      and leave_type_id = ${VACATION_ID}
      and effective_from = ${effectiveFrom}::date
  `;
}

describe.skipIf(!hasDatabase)("HR policy administration", () => {
  afterAll(async () => {
    if (!hasDatabase) {
      return;
    }

    // Audit rows are append-only, so only the rate itself is removed. The test
    // database is disposable; production never runs this suite.
    await getDb()`
      delete from leave_policies
      where user_id = ${MAYA_ID}
        and leave_type_id = ${VACATION_ID}
        and effective_from = ${effectiveFrom}::date
    `;

    await getDb().end({ timeout: 5 });
  });

  it("writes exactly one audit row per real change and none for a no-op", async () => {
    const created = await upsertPolicyRate({
      actorId: PRIYA_ID,
      userId: MAYA_ID,
      leaveTypeId: VACATION_ID,
      accrualPerMonth: 2.5,
      effectiveFrom,
    });

    expect(created).toMatchObject({
      userId: MAYA_ID,
      leaveTypeId: VACATION_ID,
      accrualPerMonth: 2.5,
      effectiveFrom,
      previousRate: 1.25,
      auditWritten: true,
    });

    const afterCreate = await auditRows();
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0]?.actor_id).toBe(PRIYA_ID);

    const updated = await upsertPolicyRate({
      actorId: PRIYA_ID,
      userId: MAYA_ID,
      leaveTypeId: VACATION_ID,
      accrualPerMonth: 3,
      effectiveFrom,
    });

    expect(updated).toMatchObject({
      accrualPerMonth: 3,
      previousRate: 2.5,
      auditWritten: true,
    });

    const afterUpdate = await auditRows();
    expect(afterUpdate).toHaveLength(2);
    expect(afterUpdate.map((row) => `${row.previous_rate}->${row.new_rate}`).sort()).toEqual([
      "1.25->2.50",
      "2.50->3.00",
    ]);

    const noop = await upsertPolicyRate({
      actorId: PRIYA_ID,
      userId: MAYA_ID,
      leaveTypeId: VACATION_ID,
      accrualPerMonth: 3,
      effectiveFrom,
    });

    expect(noop).toMatchObject({ accrualPerMonth: 3, previousRate: 3, auditWritten: false });
    expect(await auditRows()).toHaveLength(2);

    const log = await listPolicyChangeLog(100);
    const mine = log.filter(
      (change) =>
        change.employee.id === MAYA_ID &&
        change.leaveType.id === VACATION_ID &&
        change.effectiveFrom === effectiveFrom,
    );

    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({
      newRate: 3,
      actor: { id: PRIYA_ID },
    });
  });

  it("rejects an effective month in the past", async () => {
    await expect(
      upsertPolicyRate({
        actorId: PRIYA_ID,
        userId: MAYA_ID,
        leaveTypeId: VACATION_ID,
        accrualPerMonth: 2,
        effectiveFrom: "2000-01-01",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a rate for a month that has already accrued", async () => {
    // A ledger row marks the month as applied; the accrual job's idempotency
    // key is (user, leave type, period), so a change to that month can never
    // take effect. The guard must reject instead of recording a dead change.
    const accruedMonth = `${effectiveFrom.slice(0, 4)}-08-01`;

    await getDb()`
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      values (${MAYA_ID}, ${VACATION_ID}, ${accruedMonth}::date, 1)
      on conflict (user_id, leave_type_id, period) do nothing
    `;

    try {
      await expect(
        upsertPolicyRate({
          actorId: PRIYA_ID,
          userId: MAYA_ID,
          leaveTypeId: VACATION_ID,
          accrualPerMonth: 4,
          effectiveFrom: accruedMonth,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const [row] = await getDb()<{ count: string }[]>`
        select count(*)::text as count
        from leave_policies
        where user_id = ${MAYA_ID}
          and leave_type_id = ${VACATION_ID}
          and effective_from = ${accruedMonth}::date
      `;
      expect(row?.count).toBe("0");
    } finally {
      await getDb()`
        delete from accrual_ledger
        where user_id = ${MAYA_ID}
          and leave_type_id = ${VACATION_ID}
          and period = ${accruedMonth}::date
      `;
    }
  });

  it("rejects an untracked leave type", async () => {
    await expect(
      upsertPolicyRate({
        actorId: PRIYA_ID,
        userId: MAYA_ID,
        leaveTypeId: UNPAID_ID,
        accrualPerMonth: 2,
        effectiveFrom,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an unknown employee", async () => {
    await expect(
      upsertPolicyRate({
        actorId: PRIYA_ID,
        userId: "00000000-0000-4000-8000-000000000000",
        leaveTypeId: VACATION_ID,
        accrualPerMonth: 2,
        effectiveFrom,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

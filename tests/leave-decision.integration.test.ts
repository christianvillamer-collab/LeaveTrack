import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ERROR_CODES } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import {
  createLeaveRequest,
  decideLeaveRequest,
  getBalancesForUser,
  listLeaveTypes,
} from "@/lib/db/leave";
import { findUserByEmail, type DbUser } from "@/lib/db/users";
import type { LeaveType } from "@/lib/types";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("leave decision", () => {
  let daniel!: DbUser;
  let maya!: DbUser;
  let vacation!: LeaveType;
  let sick!: LeaveType;
  let unpaid!: LeaveType;
  const originalBalances = new Map<string, number>();
  const createdIds: string[] = [];
  const accrualPeriod = "2399-01-01";
  let seededAccrual = false;

  beforeAll(async () => {
    const manager = await findUserByEmail("daniel.okafor@leavetrack.demo");
    const employee = await findUserByEmail("maya.chen@leavetrack.demo");
    const types = await listLeaveTypes();

    if (!manager || !employee) {
      throw new Error("Seed users are missing; run npm run db:seed.");
    }

    const vacationType = types.find((type) => type.name === "Vacation");
    const sickType = types.find((type) => type.name === "Sick");
    const unpaidType = types.find((type) => type.name === "Unpaid");

    if (!vacationType || !sickType || !unpaidType) {
      throw new Error("Seed leave types are missing; run npm run db:seed.");
    }

    daniel = manager;
    maya = employee;
    vacation = vacationType;
    sick = sickType;
    unpaid = unpaidType;

    for (const type of [vacation, sick]) {
      const [balance] = await getDb()<{ balance: string }[]>`
        select balance
        from leave_balances
        where user_id = ${maya.id}
          and leave_type_id = ${type.id}
        limit 1
      `;

      originalBalances.set(type.id, Number(balance?.balance ?? 0));
    }

    // Seed a ledger row so the "approval does not move lastAccruedAt" assertion
    // compares real timestamps instead of passing as null === null.
    await getDb()`
      insert into accrual_ledger (user_id, leave_type_id, period, days)
      values (${maya.id}, ${sick.id}, ${accrualPeriod}::date, 0.01)
      on conflict (user_id, leave_type_id, period) do nothing
    `;
    seededAccrual = true;
  });

  afterAll(async () => {
    if (!hasDatabase) {
      return;
    }

    if (seededAccrual) {
      await getDb()`
        delete from accrual_ledger
        where user_id = ${maya.id}
          and leave_type_id = ${sick.id}
          and period = ${accrualPeriod}::date
      `;
    }

    for (const id of createdIds) {
      await getDb()`
        update leave_requests
        set is_deleted = true
        where id = ${id}
      `;
    }

    for (const [leaveTypeId, balance] of originalBalances) {
      await getDb()`
        update leave_balances
        set balance = ${balance}
        where user_id = ${maya.id}
          and leave_type_id = ${leaveTypeId}
      `;
    }

    await getDb().end({ timeout: 5 });
  });

  async function balanceFor(leaveTypeId: string): Promise<number> {
    const [row] = await getDb()<{ balance: string }[]>`
      select balance
      from leave_balances
      where user_id = ${maya.id}
        and leave_type_id = ${leaveTypeId}
      limit 1
    `;
    return Number(row?.balance ?? 0);
  }

  async function balance(): Promise<number> {
    return balanceFor(vacation.id);
  }

  async function accrualFor(leaveTypeId: string): Promise<string | null> {
    const balances = await getBalancesForUser(maya.id);
    return balances.find((balance) => balance.leaveType.id === leaveTypeId)?.lastAccruedAt ?? null;
  }

  async function createPending(
    leaveType: LeaveType,
    startDate: string,
    endDate: string,
    reason: string,
  ) {
    const result = await createLeaveRequest({
      userId: maya.id,
      leaveTypeId: leaveType.id,
      startDate,
      endDate,
      reason,
    });
    createdIds.push(result.request.id);
    return result;
  }

  it("approves a direct report request, decrements balance, and writes audit", async () => {
    const before = await balance();
    const pending = await createPending(
      vacation,
      "2031-02-03",
      "2031-02-04",
      "Decision test — approve.",
    );

    const decision = await decideLeaveRequest({
      requestId: pending.request.id,
      managerId: daniel.id,
      managerName: daniel.name,
      decision: "approved",
    });

    expect(decision.request.status).toBe("approved");
    expect(decision.balance?.previous).toBe(before);
    expect(decision.balance?.next).toBe(before - 2);

    const [row] = await getDb()<
      {
        status: string;
        decided_by: string;
        decided_at: Date | null;
        decision_note: string | null;
      }[]
    >`
      select status::text as status, decided_by, decided_at, decision_note
      from leave_requests
      where id = ${pending.request.id}
    `;

    expect(row?.status).toBe("approved");
    expect(row?.decided_by).toBe(daniel.id);
    expect(row?.decided_at).toBeInstanceOf(Date);

    const audits = await getDb()<{ action: string; actor_id: string }[]>`
      select action, actor_id
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;

    const decisionAudits = audits.filter((audit) => audit.action === "approved");
    expect(decisionAudits).toHaveLength(1);
    expect(decisionAudits[0]?.actor_id).toBe(daniel.id);
    await expect(balance()).resolves.toBe(before - 2);

    await expect(
      decideLeaveRequest({
        requestId: pending.request.id,
        managerId: daniel.id,
        managerName: daniel.name,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });

    const afterDoubleAudits = await getDb()<{ action: string }[]>`
      select action
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;
    expect(afterDoubleAudits.filter((audit) => audit.action === "approved")).toHaveLength(1);
  });

  it("rejects with a reason, leaves balance unchanged, and writes audit", async () => {
    const before = await balance();
    const pending = await createPending(
      vacation,
      "2031-02-10",
      "2031-02-11",
      "Decision test — reject.",
    );

    const decision = await decideLeaveRequest({
      requestId: pending.request.id,
      managerId: daniel.id,
      managerName: daniel.name,
      decision: "rejected",
      reason: "The team is at capacity that week.",
    });

    expect(decision.request.status).toBe("rejected");
    expect(decision.balance).toBeNull();
    await expect(balance()).resolves.toBe(before);

    const audits = await getDb()<{ action: string }[]>`
      select action
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;

    expect(audits.filter((audit) => audit.action === "rejected")).toHaveLength(1);
  });

  it("returns 403 for a request from another manager's team", async () => {
    const [kaiRequest] = await getDb()<{ id: string }[]>`
      select r.id
      from leave_requests r
      join users u on u.id = r.user_id
      where u.email = 'kai.nakamura@leavetrack.demo'
        and r.status = 'pending'
        and r.is_deleted = false
      limit 1
    `;

    expect(kaiRequest).toBeDefined();
    if (!kaiRequest) {
      return;
    }

    await expect(
      decideLeaveRequest({
        requestId: kaiRequest.id,
        managerId: daniel.id,
        managerName: daniel.name,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

    const [row] = await getDb()<{ status: string }[]>`
      select status::text as status
      from leave_requests
      where id = ${kaiRequest.id}
    `;
    expect(row?.status).toBe("pending");
  });

  it("blocks an over-balance approval without changing anything", async () => {
    const before = await balance();
    const pending = await createPending(
      vacation,
      "2031-03-01",
      "2031-03-30",
      "Decision test — over balance.",
    );

    await expect(
      decideLeaveRequest({
        requestId: pending.request.id,
        managerId: daniel.id,
        managerName: daniel.name,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });

    const [row] = await getDb()<{ status: string }[]>`
      select status::text as status
      from leave_requests
      where id = ${pending.request.id}
    `;
    const audits = await getDb()<{ action: string }[]>`
      select action
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;

    expect(row?.status).toBe("pending");
    expect(audits.filter((audit) => audit.action === "approved")).toHaveLength(0);
    await expect(balance()).resolves.toBe(before);
  });

  it("approves Unpaid leave without a balance change", async () => {
    const pending = await createPending(
      unpaid,
      "2031-04-01",
      "2031-04-02",
      "Decision test — unpaid.",
    );

    const decision = await decideLeaveRequest({
      requestId: pending.request.id,
      managerId: daniel.id,
      managerName: daniel.name,
      decision: "approved",
    });

    expect(decision.request.status).toBe("approved");
    expect(decision.balance).toBeNull();

    const balanceRows = await getDb()<{ count: string }[]>`
      select count(*)::text as count
      from leave_balances
      where user_id = ${maya.id}
        and leave_type_id = ${unpaid.id}
    `;
    expect(balanceRows[0]?.count).toBe("0");
  });

  it("approves a Sick request and leaves Vacation and Unpaid untouched", async () => {
    const sickBefore = await balanceFor(sick.id);
    const vacationBefore = await balanceFor(vacation.id);
    const accrualBefore = await accrualFor(sick.id);
    expect(accrualBefore).not.toBeNull();
    const pending = await createPending(
      sick,
      "2031-05-05",
      "2031-05-06",
      "Decision test — sick only.",
    );

    const decision = await decideLeaveRequest({
      requestId: pending.request.id,
      managerId: daniel.id,
      managerName: daniel.name,
      decision: "approved",
    });

    expect(decision.request.status).toBe("approved");
    expect(decision.balance?.leaveTypeId).toBe(sick.id);
    expect(decision.balance?.previous).toBe(sickBefore);
    expect(decision.balance?.next).toBe(sickBefore - 2);

    await expect(balanceFor(sick.id)).resolves.toBe(sickBefore - 2);
    await expect(balanceFor(vacation.id)).resolves.toBe(vacationBefore);

    const accrualAfter = await accrualFor(sick.id);
    expect(accrualAfter).toBe(accrualBefore);

    const unpaidRows = await getDb()<{ count: string }[]>`
      select count(*)::text as count
      from leave_balances
      where user_id = ${maya.id}
        and leave_type_id = ${unpaid.id}
    `;
    expect(unpaidRows[0]?.count).toBe("0");

    const audits = await getDb()<{ action: string }[]>`
      select action
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;
    expect(audits.filter((audit) => audit.action === "approved")).toHaveLength(1);
  });
});

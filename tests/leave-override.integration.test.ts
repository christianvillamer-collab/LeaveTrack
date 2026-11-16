import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ERROR_CODES } from "@/lib/api/errors";
import { canDecideTeamRequests, canOverrideRequests, canViewTeam } from "@/lib/auth/policy";
import { getDb } from "@/lib/db/client";
import {
  createLeaveRequest,
  decideLeaveRequest,
  listLeaveTypes,
  overrideLeaveRequest,
} from "@/lib/db/leave";
import { findUserByEmail, type DbUser } from "@/lib/db/users";
import type { LeaveType } from "@/lib/types";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("HR leave override", () => {
  let priya!: DbUser;
  let daniel!: DbUser;
  let kai!: DbUser;
  let vacation!: LeaveType;
  let sick!: LeaveType;
  const originalBalances = new Map<string, number>();
  const createdIds: string[] = [];

  beforeAll(async () => {
    const [hr, manager, otherTeamEmployee, types] = await Promise.all([
      findUserByEmail("priya.nair@leavetrack.demo"),
      findUserByEmail("daniel.okafor@leavetrack.demo"),
      findUserByEmail("kai.nakamura@leavetrack.demo"),
      listLeaveTypes(),
    ]);

    if (!hr || !manager || !otherTeamEmployee) {
      throw new Error("Seed users are missing; run npm run db:seed.");
    }

    const vacationType = types.find((type) => type.name === "Vacation");
    const sickType = types.find((type) => type.name === "Sick");

    if (!vacationType || !sickType) {
      throw new Error("Seed leave types are missing; run npm run db:seed.");
    }

    priya = hr;
    daniel = manager;
    kai = otherTeamEmployee;
    vacation = vacationType;
    sick = sickType;

    for (const [userId, type] of [
      [kai.id, vacation],
      [kai.id, sick],
    ] as const) {
      const [balance] = await getDb()<{ balance: string }[]>`
        select balance
        from leave_balances
        where user_id = ${userId}
          and leave_type_id = ${type.id}
        limit 1
      `;

      originalBalances.set(`${userId}:${type.id}`, Number(balance?.balance ?? 0));
    }
  });

  afterAll(async () => {
    if (!hasDatabase) {
      return;
    }

    for (const id of createdIds) {
      await getDb()`
        update leave_requests
        set is_deleted = true
        where id = ${id}
      `;
    }

    for (const [key, balance] of originalBalances) {
      const [userId, leaveTypeId] = key.split(":");
      await getDb()`
        update leave_balances
        set balance = ${balance}
        where user_id = ${userId}
          and leave_type_id = ${leaveTypeId}
      `;
    }

    await getDb().end({ timeout: 5 });
  });

  async function balanceFor(userId: string, leaveTypeId: string): Promise<number> {
    const [row] = await getDb()<{ balance: string }[]>`
      select balance
      from leave_balances
      where user_id = ${userId}
        and leave_type_id = ${leaveTypeId}
      limit 1
    `;
    return Number(row?.balance ?? 0);
  }

  async function createPendingFor(
    userId: string,
    leaveType: LeaveType,
    startDate: string,
    endDate: string,
    reason: string,
  ) {
    const result = await createLeaveRequest({
      userId,
      leaveTypeId: leaveType.id,
      startDate,
      endDate,
      reason,
    });
    createdIds.push(result.request.id);
    return result;
  }

  it("approves another manager's report, decrements balance, and audits the override", async () => {
    const before = await balanceFor(kai.id, vacation.id);
    const pending = await createPendingFor(
      kai.id,
      vacation,
      "2032-02-02",
      "2032-02-03",
      "Override test — approve across teams.",
    );

    const decision = await overrideLeaveRequest({
      requestId: pending.request.id,
      actorId: priya.id,
      actorName: priya.name,
      decision: "approved",
      reason: "Erin is on leave; payroll confirmed the accrual.",
    });

    expect(decision.request.status).toBe("approved");
    expect(decision.balance?.previous).toBe(before);
    expect(decision.balance?.next).toBe(before - 2);

    const [row] = await getDb()<
      {
        status: string;
        decided_by: string;
        decision_note: string | null;
      }[]
    >`
      select status::text as status, decided_by, decision_note
      from leave_requests
      where id = ${pending.request.id}
    `;

    expect(row?.status).toBe("approved");
    expect(row?.decided_by).toBe(priya.id);
    expect(row?.decision_note).toBe("Erin is on leave; payroll confirmed the accrual.");

    const audits = await getDb()<{ action: string; actor_id: string; detail: string | null }[]>`
      select action, actor_id, detail
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;

    const approved = audits.filter((audit) => audit.action === "approved");
    expect(approved).toHaveLength(1);
    expect(approved[0]?.actor_id).toBe(priya.id);
    expect(approved[0]?.detail).toMatch(/^HR override — approved by /);
    expect(approved[0]?.detail).toContain("Erin is on leave; payroll confirmed the accrual.");

    await expect(balanceFor(kai.id, vacation.id)).resolves.toBe(before - 2);
  });

  it("rejects with a reason and leaves the balance unchanged", async () => {
    const before = await balanceFor(kai.id, sick.id);
    const pending = await createPendingFor(
      kai.id,
      sick,
      "2032-03-08",
      "2032-03-09",
      "Override test — reject across teams.",
    );

    const decision = await overrideLeaveRequest({
      requestId: pending.request.id,
      actorId: priya.id,
      actorName: priya.name,
      decision: "rejected",
      reason: "Duplicate of an existing approved request.",
    });

    expect(decision.request.status).toBe("rejected");
    expect(decision.balance).toBeNull();
    await expect(balanceFor(kai.id, sick.id)).resolves.toBe(before);

    const audits = await getDb()<{ action: string; detail: string | null }[]>`
      select action, detail
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;

    const rejected = audits.filter((audit) => audit.action === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.detail).toMatch(/^HR override — rejected by /);
    expect(rejected[0]?.detail).toContain("Duplicate of an existing approved request.");
  });

  it("requires a non-blank override reason", async () => {
    const pending = await createPendingFor(
      kai.id,
      vacation,
      "2032-04-05",
      "2032-04-06",
      "Override test — missing reason.",
    );

    await expect(
      overrideLeaveRequest({
        requestId: pending.request.id,
        actorId: priya.id,
        actorName: priya.name,
        decision: "approved",
        reason: "   ",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });

    const [row] = await getDb()<{ status: string }[]>`
      select status::text as status
      from leave_requests
      where id = ${pending.request.id}
    `;
    expect(row?.status).toBe("pending");
  });

  it("returns 409 on a duplicate override without a second audit row", async () => {
    const pending = await createPendingFor(
      kai.id,
      vacation,
      "2032-05-10",
      "2032-05-11",
      "Override test — duplicate.",
    );

    await overrideLeaveRequest({
      requestId: pending.request.id,
      actorId: priya.id,
      actorName: priya.name,
      decision: "approved",
      reason: "First and only decision.",
    });

    await expect(
      overrideLeaveRequest({
        requestId: pending.request.id,
        actorId: priya.id,
        actorName: priya.name,
        decision: "rejected",
        reason: "Attempting a second decision.",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });

    const audits = await getDb()<{ action: string }[]>`
      select action
      from audit_log
      where leave_request_id = ${pending.request.id}
    `;
    expect(audits.filter((audit) => audit.action !== "submitted")).toHaveLength(1);
  });

  it("forbids HR from overriding their own request", async () => {
    const pending = await createPendingFor(
      priya.id,
      vacation,
      "2032-06-14",
      "2032-06-15",
      "Override test — own request.",
    );

    await expect(
      overrideLeaveRequest({
        requestId: pending.request.id,
        actorId: priya.id,
        actorName: priya.name,
        decision: "approved",
        reason: "Should never be allowed.",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

    const [row] = await getDb()<{ status: string }[]>`
      select status::text as status
      from leave_requests
      where id = ${pending.request.id}
    `;
    expect(row?.status).toBe("pending");
  });

  it("keeps the over-balance guard for HR in E2-07", async () => {
    const before = await balanceFor(kai.id, vacation.id);
    const pending = await createPendingFor(
      kai.id,
      vacation,
      "2032-07-01",
      "2032-07-31",
      "Override test — over balance.",
    );

    await expect(
      overrideLeaveRequest({
        requestId: pending.request.id,
        actorId: priya.id,
        actorName: priya.name,
        decision: "approved",
        reason: "Would overdraw the balance.",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });

    const [row] = await getDb()<{ status: string }[]>`
      select status::text as status
      from leave_requests
      where id = ${pending.request.id}
    `;
    expect(row?.status).toBe("pending");
    await expect(balanceFor(kai.id, vacation.id)).resolves.toBe(before);
  });

  it("keeps managers out of other teams and HR out of the manager endpoints", async () => {
    const pending = await createPendingFor(
      kai.id,
      vacation,
      "2032-08-16",
      "2032-08-17",
      "Override test — manager boundary.",
    );

    await expect(
      decideLeaveRequest({
        requestId: pending.request.id,
        managerId: daniel.id,
        managerName: daniel.name,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

    expect(canDecideTeamRequests("hr_admin")).toBe(false);
    expect(canViewTeam("hr_admin")).toBe(false);
    expect(canOverrideRequests("manager")).toBe(false);
  });
});

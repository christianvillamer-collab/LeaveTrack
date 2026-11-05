import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { createLeaveRequest, listLeaveTypes } from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("createLeaveRequest integration", () => {
  const createdIds: string[] = [];

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

    await getDb().end({ timeout: 5 });
  });

  it("creates a pending request, writes the audit row, and leaves the balance unchanged", async () => {
    const user = await findUserByEmail("maya.chen@leavetrack.demo");
    const leaveTypes = await listLeaveTypes();
    const vacation = leaveTypes.find((type) => type.name === "Vacation");

    expect(user).not.toBeNull();
    expect(vacation).toBeDefined();

    if (!user || !vacation) {
      return;
    }

    const [before] = await getDb()<{ balance: string }[]>`
      select balance
      from leave_balances
      where user_id = ${user.id}
        and leave_type_id = ${vacation.id}
      limit 1
    `;

    const result = await createLeaveRequest({
      userId: user.id,
      leaveTypeId: vacation.id,
      startDate: "2030-03-04",
      endDate: "2030-03-08",
      reason: "Integration test — five day vacation request.",
    });
    createdIds.push(result.request.id);

    expect(result.request.status).toBe("pending");
    expect(result.request.days).toBe(5);
    expect(result.warning.exceedsBalance).toBe(false);
    expect(result.managerNotified).toBe(true);

    const audits = await getDb()<{ action: string; actor_id: string }[]>`
      select action, actor_id
      from audit_log
      where leave_request_id = ${result.request.id}
    `;

    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("submitted");
    expect(audits[0]?.actor_id).toBe(user.id);

    const [after] = await getDb()<{ balance: string }[]>`
      select balance
      from leave_balances
      where user_id = ${user.id}
        and leave_type_id = ${vacation.id}
      limit 1
    `;

    expect(after?.balance).toBe(before?.balance);
  });

  it("warns but still creates an over-balance request without deducting", async () => {
    const user = await findUserByEmail("maya.chen@leavetrack.demo");
    const leaveTypes = await listLeaveTypes();
    const vacation = leaveTypes.find((type) => type.name === "Vacation");

    expect(user).not.toBeNull();
    expect(vacation).toBeDefined();

    if (!user || !vacation) {
      return;
    }

    const [before] = await getDb()<{ balance: string }[]>`
      select balance
      from leave_balances
      where user_id = ${user.id}
        and leave_type_id = ${vacation.id}
      limit 1
    `;

    const result = await createLeaveRequest({
      userId: user.id,
      leaveTypeId: vacation.id,
      startDate: "2030-04-01",
      endDate: "2030-04-30",
      reason: "Integration test — deliberately over balance.",
    });
    createdIds.push(result.request.id);

    expect(result.request.status).toBe("pending");
    expect(result.warning.exceedsBalance).toBe(true);
    expect(result.warning.requestedDays).toBe(30);

    const [after] = await getDb()<{ balance: string }[]>`
      select balance
      from leave_balances
      where user_id = ${user.id}
        and leave_type_id = ${vacation.id}
      limit 1
    `;

    expect(after?.balance).toBe(before?.balance);
  });

  it("creates an Unpaid request without a balance check", async () => {
    const user = await findUserByEmail("maya.chen@leavetrack.demo");
    const leaveTypes = await listLeaveTypes();
    const unpaid = leaveTypes.find((type) => type.name === "Unpaid");

    expect(user).not.toBeNull();
    expect(unpaid).toBeDefined();

    if (!user || !unpaid) {
      return;
    }

    const [beforeRows] = await getDb()<{ count: string }[]>`
      select count(*)::text as count
      from leave_balances
      where user_id = ${user.id}
    `;

    const result = await createLeaveRequest({
      userId: user.id,
      leaveTypeId: unpaid.id,
      startDate: "2030-05-01",
      endDate: "2030-05-10",
      reason: "Integration test — unpaid leave has no balance policy.",
    });
    createdIds.push(result.request.id);

    expect(result.request.status).toBe("pending");
    expect(result.request.days).toBe(10);
    expect(result.warning).toEqual({
      exceedsBalance: false,
      requestedDays: 10,
      availableDays: null,
      message: null,
    });
    expect(result.managerNotified).toBe(true);

    const [afterRows] = await getDb()<{ count: string }[]>`
      select count(*)::text as count
      from leave_balances
      where user_id = ${user.id}
    `;
    const [unpaidRows] = await getDb()<{ count: string }[]>`
      select count(*)::text as count
      from leave_balances
      where user_id = ${user.id}
        and leave_type_id = ${unpaid.id}
    `;

    expect(afterRows?.count).toBe(beforeRows?.count);
    expect(unpaidRows?.count).toBe("0");

    const audits = await getDb()<{ action: string; actor_id: string }[]>`
      select action, actor_id
      from audit_log
      where leave_request_id = ${result.request.id}
    `;

    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("submitted");
    expect(audits[0]?.actor_id).toBe(user.id);
  });
});

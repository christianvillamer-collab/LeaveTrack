import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { getBalancesForUser, getMyLeaveData } from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);

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

    expect(vacation?.confirmed).toBe(12.5);
    expect(vacation?.pending).toBe(5);
    expect(sick?.confirmed).toBe(8);
    expect(sick?.pending).toBe(0);
    expect(unpaid?.confirmed).toBeNull();
    expect(vacation?.lastAccruedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAuditReport } from "@/lib/db/audit";
import { getDb } from "@/lib/db/client";
import { createLeaveRequest, decideLeaveRequest, listLeaveTypes } from "@/lib/db/leave";
import { findUserByEmail, type DbUser } from "@/lib/db/users";
import type { LeaveType } from "@/lib/types";
import { formatRequestReference } from "@/lib/utils/format";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("employee audit report", () => {
  let daniel!: DbUser;
  let maya!: DbUser;
  let luis!: DbUser;
  let vacation!: LeaveType;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const manager = await findUserByEmail("daniel.okafor@leavetrack.demo");
    const employee = await findUserByEmail("maya.chen@leavetrack.demo");
    const otherEmployee = await findUserByEmail("luis.ortega@leavetrack.demo");
    const types = await listLeaveTypes();

    if (!manager || !employee || !otherEmployee) {
      throw new Error("Seed users are missing; run npm run db:seed.");
    }

    const vacationType = types.find((type) => type.name === "Vacation");

    if (!vacationType) {
      throw new Error("Seed leave types are missing; run npm run db:seed.");
    }

    daniel = manager;
    maya = employee;
    luis = otherEmployee;
    vacation = vacationType;
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

    await getDb().end({ timeout: 5 });
  });

  async function createPending(startDate: string, endDate: string, reason: string) {
    const result = await createLeaveRequest({
      userId: maya.id,
      leaveTypeId: vacation.id,
      startDate,
      endDate,
      reason,
    });

    createdIds.push(result.request.id);
    return result.request.id;
  }

  it("returns every request with status, decision-maker, and timestamp", async () => {
    const requestId = await createPending("2032-03-01", "2032-03-02", "Audit report — decision.");

    await decideLeaveRequest({
      requestId,
      managerId: daniel.id,
      managerName: daniel.name,
      decision: "rejected",
      reason: "Audit report test — team capacity.",
    });

    const report = await getAuditReport(maya.id);

    expect(report).not.toBeNull();
    expect(report?.employee.id).toBe(maya.id);

    const entry = report?.requests.find((request) => request.id === requestId);

    expect(entry).toBeDefined();
    expect(entry?.status).toBe("rejected");
    expect(entry?.decidedBy?.id).toBe(daniel.id);
    expect(entry?.decidedAt).toBeTruthy();
    expect(entry?.reference).toBe(formatRequestReference(requestId));
    expect(entry?.days).toBe(2);

    const events = report?.events.filter((event) => event.requestId === requestId) ?? [];

    expect(events.map((event) => event.action).sort()).toEqual(["rejected", "submitted"]);
    expect(events.find((event) => event.action === "rejected")?.actor.id).toBe(daniel.id);
  });

  it("excludes soft-deleted requests without purging the row", async () => {
    const requestId = await createPending(
      "2032-04-05",
      "2032-04-06",
      "Audit report — soft delete.",
    );

    await getDb()`
      update leave_requests
      set is_deleted = true
      where id = ${requestId}
    `;

    const report = await getAuditReport(maya.id);

    expect(report?.requests.some((request) => request.id === requestId)).toBe(false);
    expect(report?.events.some((event) => event.requestId === requestId)).toBe(false);

    const [row] = await getDb()<{ is_deleted: boolean }[]>`
      select is_deleted
      from leave_requests
      where id = ${requestId}
    `;

    const [auditRow] = await getDb()<{ count: number }[]>`
      select count(*)::int as count
      from audit_log
      where leave_request_id = ${requestId}
    `;

    expect(row?.is_deleted).toBe(true);
    expect(auditRow?.count).toBeGreaterThan(0);
  });

  it("returns null for an employee that does not exist", async () => {
    await expect(getAuditReport("00000000-0000-4000-8000-000000000000")).resolves.toBeNull();
  });

  it("never includes another employee's requests", async () => {
    const requestId = await createPending("2032-05-10", "2032-05-10", "Audit report — isolation.");
    const report = await getAuditReport(luis.id);

    expect(report?.employee.id).toBe(luis.id);
    expect(report?.requests.some((request) => request.id === requestId)).toBe(false);
    expect(report?.events.some((event) => event.requestId === requestId)).toBe(false);
  });
});

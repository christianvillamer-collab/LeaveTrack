import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAuditReport } from "@/lib/db/audit";
import { getDb } from "@/lib/db/client";
import { createLeaveRequest, decideLeaveRequest, listLeaveTypes } from "@/lib/db/leave";
import { findUserByEmail, type DbUser } from "@/lib/db/users";
import type { LeaveType } from "@/lib/types";

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

  /** UTC calendar day for relative offsets, matching the SQL day bounds. */
  function utcDay(offsetDays = 0): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
  }

  /** Append an audit row with an explicit timestamp (the log forbids updates). */
  async function insertDatedEvent(
    requestId: string,
    actorId: string,
    occurredAt: string,
    detail: string,
  ) {
    await getDb()`
      insert into audit_log (leave_request_id, actor_id, action, detail, occurred_at)
      values (${requestId}, ${actorId}, 'submitted', ${detail}, ${occurredAt}::timestamptz)
    `;
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
    const [stored] = await getDb()<{ reference: string }[]>`
      select reference from leave_requests where id = ${requestId}
    `;

    expect(entry).toBeDefined();
    expect(entry?.status).toBe("rejected");
    expect(entry?.decidedBy?.id).toBe(daniel.id);
    expect(entry?.decidedAt).toBeTruthy();
    expect(entry?.reference).toBe(stored?.reference);
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

    const report = await getAuditReport(maya.id, { from: utcDay(-1), to: utcDay(1) });

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

  it("filters requests and events by inclusive UTC calendar bounds", async () => {
    const requestId = await createPending(
      "2036-06-01",
      "2036-06-02",
      "Audit report — inclusive bounds.",
    );

    const onDay = await getAuditReport(maya.id, { from: utcDay(0), to: utcDay(0) });
    expect(onDay?.requests.some((request) => request.id === requestId)).toBe(true);
    expect(
      (onDay?.events.filter((event) => event.requestId === requestId) ?? []).length,
    ).toBeGreaterThan(0);

    const after = await getAuditReport(maya.id, { from: utcDay(1) });
    expect(after?.requests.some((request) => request.id === requestId)).toBe(false);
    expect(after?.events.some((event) => event.requestId === requestId)).toBe(false);

    const before = await getAuditReport(maya.id, { to: utcDay(-1) });
    expect(before?.requests.some((request) => request.id === requestId)).toBe(false);
    expect(before?.events.some((event) => event.requestId === requestId)).toBe(false);
  });

  it("reports audit history older than three years without an upper cap", async () => {
    const requestId = await createPending(
      "2037-01-04",
      "2037-01-05",
      "Audit report — old history.",
    );
    const old = "2022-06-15T10:30:00.000Z";

    await getDb()`
      update leave_requests
      set created_at = ${old}::timestamptz
      where id = ${requestId}
    `;
    await insertDatedEvent(requestId, maya.id, old, "Dated old history event");

    const report = await getAuditReport(maya.id, { from: "2022-06-15", to: "2022-06-15" });

    expect(report?.requests.some((request) => request.id === requestId)).toBe(true);
    expect(
      report?.events.some(
        (event) => event.requestId === requestId && event.detail === "Dated old history event",
      ),
    ).toBe(true);
  });

  it("orders same-timestamp events newest-id first so pagination is stable", async () => {
    const requestId = await createPending(
      "2038-02-01",
      "2038-02-01",
      "Audit report — stable ordering.",
    );
    const stamp = "2026-02-02T09:00:00.000Z";
    await insertDatedEvent(requestId, maya.id, stamp, "stable-a");
    await insertDatedEvent(requestId, maya.id, stamp, "stable-b");

    const report = await getAuditReport(maya.id, { from: "2026-02-02", to: "2026-02-02" });
    const ids = (report?.events ?? [])
      .filter((event) => event.detail === "stable-a" || event.detail === "stable-b")
      .map((event) => event.id);

    expect(ids).toHaveLength(2);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it("returns empty requests and events for a range with no history", async () => {
    const report = await getAuditReport(maya.id, { from: "2099-01-01", to: "2099-01-31" });

    expect(report?.employee.id).toBe(maya.id);
    expect(report?.requests).toEqual([]);
    expect(report?.events).toEqual([]);
  });

  it("filters paged reports by request status", async () => {
    const requestId = await createPending("2039-03-01", "2039-03-02", "Audit report — status.");
    await decideLeaveRequest({
      requestId,
      managerId: daniel.id,
      managerName: daniel.name,
      decision: "rejected",
      reason: "Audit report status filter — capacity.",
    });

    const rejected = await getAuditReport(maya.id, {
      status: "rejected",
      page: 1,
      pageSize: 100,
    });
    const pending = await getAuditReport(maya.id, {
      status: "pending",
      page: 1,
      pageSize: 100,
    });

    expect(rejected?.requests.every((request) => request.status === "rejected")).toBe(true);
    expect(rejected?.requests.some((request) => request.id === requestId)).toBe(true);
    expect(
      rejected?.events.some(
        (event) => event.requestId === requestId && event.action === "rejected",
      ),
    ).toBe(true);
    expect(pending?.requests.some((request) => request.id === requestId)).toBe(false);
  });

  it("paginates events but can export the full filtered set", async () => {
    const requestId = await createPending("2040-04-01", "2040-04-02", "Audit report — export all.");
    const paged = await getAuditReport(maya.id, { page: 1, pageSize: 1 });
    const exported = await getAuditReport(maya.id, {
      page: 1,
      pageSize: 1,
      exportAll: true,
    });

    expect(paged?.events).toHaveLength(1);
    expect(exported?.events.length).toBe(exported?.pagination.total);
    expect(exported?.pagination.pageCount).toBe(1);
    expect(exported?.events.some((event) => event.requestId === requestId)).toBe(true);
    expect(exported?.events.length).toBeGreaterThanOrEqual(paged?.events.length ?? 0);
  });

  it("keeps the event total when the requested page is past the end", async () => {
    const all = await getAuditReport(maya.id, { page: 1, pageSize: 100 });
    const pastEnd = await getAuditReport(maya.id, { page: 99, pageSize: 25 });

    expect(pastEnd?.events).toEqual([]);
    expect(pastEnd?.pagination.total).toBe(all?.pagination.total ?? 0);
    expect(pastEnd?.pagination.pageCount).toBe(
      Math.max(1, Math.ceil((all?.pagination.total ?? 0) / 25)),
    );
  });

  it("excludes soft-deleted requests from paged reports", async () => {
    const requestId = await createPending(
      "2041-05-01",
      "2041-05-02",
      "Audit report — paged soft delete.",
    );
    await getDb()`
      update leave_requests
      set is_deleted = true
      where id = ${requestId}
    `;

    const report = await getAuditReport(maya.id, { page: 1, pageSize: 100 });

    expect(report?.requests.some((request) => request.id === requestId)).toBe(false);
    expect(report?.events.some((event) => event.requestId === requestId)).toBe(false);
  });
});

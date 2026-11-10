import { afterAll, describe, expect, it } from "vitest";

import { listAuditEventsForRequest } from "@/lib/db/audit";
import { getDb } from "@/lib/db/client";
import { getLeaveRequestDetail, listScopedLeaveRequests } from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const APPROVED_REQUEST_ID = "b0000000-0000-4000-8000-000000000002";
const PENDING_REQUEST_ID = "b0000000-0000-4000-8000-000000000004";

describe.skipIf(!hasDatabase)("/requests and /requests/[id] data", () => {
  afterAll(async () => {
    if (hasDatabase) {
      await getDb().end({ timeout: 5 });
    }
  });

  it("gives an employee only their own requests", async () => {
    const maya = await findUserByEmail("maya.chen@leavetrack.demo");
    expect(maya).not.toBeNull();

    if (!maya) {
      return;
    }

    const rows = await listScopedLeaveRequests({ id: maya.id, role: maya.role });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.employee.id === maya.id)).toBe(true);
    expect(rows[0]?.reference).toMatch(/^LR-/);
  });

  it("gives a manager their own requests plus direct reports, and nobody else", async () => {
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");
    const priya = await findUserByEmail("priya.nair@leavetrack.demo");
    const kai = await findUserByEmail("kai.nakamura@leavetrack.demo");

    expect(daniel).not.toBeNull();
    expect(priya).not.toBeNull();
    expect(kai).not.toBeNull();

    if (!daniel || !priya || !kai) {
      return;
    }

    const rows = await listScopedLeaveRequests({ id: daniel.id, role: daniel.role });
    const employeeIds = new Set(rows.map((row) => row.employee.id));
    const reports = await getDb()<{ id: string }[]>`
      select id
      from users
      where manager_id = ${daniel.id}
    `;

    expect(employeeIds.has(daniel.id)).toBe(true);

    for (const report of reports) {
      expect(employeeIds.has(report.id)).toBe(true);
    }

    expect(employeeIds.has(priya.id)).toBe(false);
    expect(employeeIds.has(kai.id)).toBe(false);
  });

  it("gives HR every active request", async () => {
    const priya = await findUserByEmail("priya.nair@leavetrack.demo");
    const kai = await findUserByEmail("kai.nakamura@leavetrack.demo");

    expect(priya).not.toBeNull();
    expect(kai).not.toBeNull();

    if (!priya || !kai) {
      return;
    }

    const rows = await listScopedLeaveRequests({ id: priya.id, role: priya.role });
    const [active] = await getDb()<{ count: string }[]>`
      select count(*)::text as count
      from leave_requests
      where is_deleted = false
    `;

    expect(rows.length).toBe(Number(active?.count ?? 0));
    expect(rows.some((row) => row.employee.id === kai.id)).toBe(true);
  });

  it("returns the detail with owner, manager, decision, and reference", async () => {
    const detail = await getLeaveRequestDetail(APPROVED_REQUEST_ID);

    expect(detail).not.toBeNull();
    expect(detail?.employee.email).toBe("maya.chen@leavetrack.demo");
    expect(detail?.employee.managerName).toBe("Daniel Okafor");
    expect(detail?.decidedBy?.name).toBe("Daniel Okafor");
    expect(detail?.decisionNote).toBe("Get well soon.");
    expect(detail?.reference).toMatch(/^LR-/);
  });

  it("returns null for an unknown id", async () => {
    await expect(getLeaveRequestDetail("00000000-0000-4000-8000-000000000000")).resolves.toBeNull();
  });

  it("hides a soft-deleted request from the list and the detail", async () => {
    const [before] = await getDb()<{ id: string }[]>`
      select id
      from leave_requests
      where id = ${PENDING_REQUEST_ID}
        and is_deleted = false
    `;

    if (!before) {
      return;
    }

    const hr = await findUserByEmail("priya.nair@leavetrack.demo");

    if (!hr) {
      return;
    }

    try {
      await getDb()`
        update leave_requests
        set is_deleted = true
        where id = ${PENDING_REQUEST_ID}
      `;

      await expect(getLeaveRequestDetail(PENDING_REQUEST_ID)).resolves.toBeNull();

      const rows = await listScopedLeaveRequests({ id: hr.id, role: hr.role });
      expect(rows.some((row) => row.id === PENDING_REQUEST_ID)).toBe(false);
    } finally {
      await getDb()`
        update leave_requests
        set is_deleted = false
        where id = ${PENDING_REQUEST_ID}
      `;
    }
  });

  it("lists only the request's audit rows, oldest first", async () => {
    const events = await listAuditEventsForRequest(APPROVED_REQUEST_ID);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.requestId === APPROVED_REQUEST_ID)).toBe(true);

    const timestamps = events.map((event) => event.occurredAt);
    expect([...timestamps].sort()).toEqual(timestamps);
  });
});

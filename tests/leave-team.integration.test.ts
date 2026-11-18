import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import {
  getTeamLeaveData,
  listMyLeaveRequestsPage,
  listScopedLeaveRequestsPage,
  listTeamLeaveRequestsPage,
} from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("manager team queue", () => {
  afterAll(async () => {
    if (hasDatabase) {
      await getDb().end({ timeout: 5 });
    }
  });

  it("returns exactly Daniel's five direct reports and their requests", async () => {
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");
    expect(daniel).not.toBeNull();
    expect(daniel?.role).toBe("manager");

    if (!daniel) {
      return;
    }

    const data = await getTeamLeaveData(daniel.id);
    const reportNames = data.directReports.map((report) => report.name).sort();
    const employeeNames = [
      ...new Set(data.requests.map((request) => request.employee.name)),
    ].sort();

    expect(reportNames).toEqual([
      "Amara Diallo",
      "Luis Ortega",
      "Maya Chen",
      "Sana Iqbal",
      "Tom Becker",
    ]);
    expect(employeeNames).toEqual(reportNames);
    expect(data.requests.filter((request) => request.status === "pending")).toHaveLength(4);
    expect(
      data.requests.some(
        (request) =>
          request.employee.name === "Kai Nakamura" || request.employee.name === "Nina Petrov",
      ),
    ).toBe(false);
  });

  it("moves a pending request when the employee's manager changes", async () => {
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");
    const erin = await findUserByEmail("erin.walsh@leavetrack.demo");
    const tom = await findUserByEmail("tom.becker@leavetrack.demo");

    expect(daniel).not.toBeNull();
    expect(erin).not.toBeNull();
    expect(tom).not.toBeNull();
    expect(tom?.managerId).toBe(daniel?.id);

    if (!daniel || !erin || !tom) {
      return;
    }

    const originalManagerId = tom.managerId;

    try {
      await getDb()`
        update users
        set manager_id = ${erin.id}
        where id = ${tom.id}
      `;

      const danielData = await getTeamLeaveData(daniel.id);
      const erinData = await getTeamLeaveData(erin.id);

      expect(danielData.requests.some((request) => request.employee.id === tom.id)).toBe(false);
      expect(danielData.directReports.some((report) => report.id === tom.id)).toBe(false);
      expect(erinData.requests.some((request) => request.employee.id === tom.id)).toBe(true);
      expect(erinData.directReports.some((report) => report.id === tom.id)).toBe(true);
      expect(erinData.requests.find((request) => request.employee.id === tom.id)?.status).toBe(
        "pending",
      );
    } finally {
      await getDb()`
        update users
        set manager_id = ${originalManagerId}
        where id = ${tom.id}
      `;
    }
  });

  it("filters status and pages the scoped queue in Postgres", async () => {
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");
    expect(daniel?.role).toBe("manager");
    if (!daniel) return;

    const options = { status: "pending" as const, page: 1, pageSize: 2 };
    const first = await listScopedLeaveRequestsPage({ id: daniel.id, role: daniel.role }, options);
    const full = await listScopedLeaveRequestsPage(
      { id: daniel.id, role: daniel.role },
      { status: "pending", page: 1, pageSize: 100 },
    );

    expect(first.items.every((request) => request.status === "pending")).toBe(true);
    expect(first.pagination.total).toBe(full.items.length);
    expect(first.pagination.pageCount).toBe(Math.ceil(full.items.length / 2));
    expect(first.items.map((request) => request.id)).toEqual(
      full.items.slice(0, 2).map((request) => request.id),
    );

    const second = await listScopedLeaveRequestsPage(
      { id: daniel.id, role: daniel.role },
      { status: "pending", page: 2, pageSize: 2 },
    );
    const pageIds = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(pageIds.size).toBe(Math.min(4, full.items.length));
  });

  it("keeps the total when the requested page is past the end", async () => {
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");
    expect(daniel?.role).toBe("manager");
    if (!daniel) return;

    const all = await listScopedLeaveRequestsPage(
      { id: daniel.id, role: daniel.role },
      { status: "pending", page: 1, pageSize: 100 },
    );
    const pastEnd = await listScopedLeaveRequestsPage(
      { id: daniel.id, role: daniel.role },
      { status: "pending", page: 99, pageSize: 25 },
    );

    expect(pastEnd.items).toEqual([]);
    expect(pastEnd.pagination.total).toBe(all.items.length);
    expect(pastEnd.pagination.pageCount).toBe(Math.max(1, Math.ceil(all.items.length / 25)));
  });

  it("keeps cross-team requests out of the paged manager queue", async () => {
    const daniel = await findUserByEmail("daniel.okafor@leavetrack.demo");
    const erin = await findUserByEmail("erin.walsh@leavetrack.demo");
    if (!daniel || !erin) return;

    const danielPage = await listTeamLeaveRequestsPage(daniel.id, {
      page: 1,
      pageSize: 100,
    });
    const erinPage = await listTeamLeaveRequestsPage(erin.id, {
      page: 1,
      pageSize: 100,
    });

    expect(
      danielPage.items.some(
        (request) =>
          request.employee.name === "Kai Nakamura" || request.employee.name === "Nina Petrov",
      ),
    ).toBe(false);
    expect(
      erinPage.items.some((request) => danielPage.items.some((other) => other.id === request.id)),
    ).toBe(false);
  });

  it("breaks same-timestamp request pages by id descending", async () => {
    const maya = await findUserByEmail("maya.chen@leavetrack.demo");
    if (!maya) return;

    const [type] = await getDb()<{ id: string }[]>`
      select id from leave_types where name = 'Vacation' limit 1
    `;
    if (!type) return;

    const stamp = "2098-01-01T09:00:00.000Z";
    const ids: string[] = [];

    try {
      for (const detail of ["paged-tie-a", "paged-tie-b"]) {
        const [row] = await getDb()<{ id: string }[]>`
          insert into leave_requests (user_id, leave_type_id, start_date, end_date, reason)
          values (${maya.id}, ${type.id}, date '2098-01-02', date '2098-01-03', ${detail})
          returning id
        `;
        expect(row?.id).toBeTruthy();
        if (row) {
          ids.push(row.id);
          await getDb()`
            update leave_requests
            set created_at = ${stamp}::timestamptz
            where id = ${row.id}
          `;
        }
      }

      const first = await listMyLeaveRequestsPage(maya.id, { page: 1, pageSize: 1 });
      const second = await listMyLeaveRequestsPage(maya.id, { page: 2, pageSize: 1 });

      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(first.items[0]?.id).toBe([...ids].sort().reverse()[0]);
      expect(second.items[0]?.id).toBe([...ids].sort().reverse()[1]);
    } finally {
      for (const id of ids) {
        await getDb()`
          update leave_requests
          set is_deleted = true
          where id = ${id}
        `;
      }
    }
  });
});

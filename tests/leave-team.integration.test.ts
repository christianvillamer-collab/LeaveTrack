import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { getTeamLeaveData } from "@/lib/db/leave";
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
});

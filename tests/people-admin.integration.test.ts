import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { listTeamLeaveRequests } from "@/lib/db/leave";
import {
  bulkImportPeople,
  listPersonAudit,
  listPeople,
  reassignManager,
  setPersonActive,
  updatePersonProfile,
} from "@/lib/db/people";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const PRIYA_ID = "a0000000-0000-4000-8000-000000000003";
const DANIEL_ID = "a0000000-0000-4000-8000-000000000001";
const MAYA_ID = "a0000000-0000-4000-8000-000000000004";
const VACATION_ID = "11111111-1111-4111-8111-111111111111";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${randomUUID()}@leavetrack.demo`;
}

async function insertPerson({
  name = "Temp Person",
  email,
  role = "employee",
  managerId = null,
  isActive = true,
}: {
  name?: string;
  email: string;
  role?: "employee" | "manager" | "hr_admin";
  managerId?: string | null;
  isActive?: boolean;
}): Promise<string> {
  const [row] = await getDb()<{ id: string }[]>`
    insert into users (name, email, role, manager_id, is_active, deactivated_at)
    values (
      ${name},
      ${email},
      ${role}::user_role,
      ${managerId},
      ${isActive},
      ${isActive ? null : new Date()}
    )
    returning id
  `;

  return row.id;
}

async function auditCount(subjectId: string, action?: string): Promise<number> {
  const [row] = await getDb()<{ count: number }[]>`
    select count(*)::int as count
    from user_audit_log
    where subject_id = ${subjectId}
      and (${action ?? null}::text is null or action = ${action ?? null})
  `;

  return row.count;
}

describe.skipIf(!hasDatabase)("HR people administration", () => {
  afterAll(async () => {
    if (hasDatabase) {
      await getDb().end({ timeout: 5 });
    }
  });

  it("lists people with the manager resolved", async () => {
    const people = await listPeople();

    expect(people.length).toBeGreaterThanOrEqual(10);
    expect(people.find((person) => person.id === MAYA_ID)).toMatchObject({
      name: "Maya Chen",
      managerName: "Daniel Okafor",
      isActive: true,
    });
  });

  it("writes exactly one profile audit row per real change and none for a no-op", async () => {
    const email = uniqueEmail("profile");
    const id = await insertPerson({ email });

    const first = await updatePersonProfile(PRIYA_ID, id, {
      name: "Profile Person",
      email,
      jobTitle: "Analyst",
      team: "Operations",
    });

    expect(first).toMatchObject({ id, changed: true, auditWritten: true });
    expect(await auditCount(id, "profile_updated")).toBe(1);

    const noop = await updatePersonProfile(PRIYA_ID, id, {
      name: "Profile Person",
      email,
      jobTitle: "Analyst",
      team: "Operations",
    });

    expect(noop).toMatchObject({ changed: false, auditWritten: false });
    expect(await auditCount(id, "profile_updated")).toBe(1);
  });

  it("allows correcting the directory email on unlinked and linked rows", async () => {
    const email = uniqueEmail("unlinked");
    const id = await insertPerson({ email });

    // An unlinked row has no provider subject yet, so the directory address is
    // only the fallback key for the first sign-in. HR must be able to fix a typo
    // before that identity is bound.
    const corrected = uniqueEmail("corrected");
    const unlinked = await updatePersonProfile(PRIYA_ID, id, {
      name: "Unlinked Person",
      email: corrected,
      jobTitle: null,
      team: null,
    });

    expect(unlinked).toMatchObject({ changed: true, auditWritten: true });

    const subject = randomUUID();
    await getDb()`update users set auth_subject = ${subject} where id = ${id}`;

    const nextEmail = uniqueEmail("linked");
    const linked = await updatePersonProfile(PRIYA_ID, id, {
      name: "Unlinked Person",
      email: nextEmail,
      jobTitle: null,
      team: null,
    });

    expect(linked.changed).toBe(true);

    const [row] = await getDb()<{ email: string }[]>`
      select email from users where id = ${id}
    `;
    expect(row.email).toBe(nextEmail);
  });

  it("rejects duplicate directory emails with a conflict", async () => {
    const email = uniqueEmail("duplicate");
    await insertPerson({ email });

    await expect(
      updatePersonProfile(PRIYA_ID, MAYA_ID, {
        name: "Maya Chen",
        email,
        jobTitle: "Product Designer",
        team: "Product",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("reassigns a manager, rejects cycles and inactive candidates, and skips no-ops", async () => {
    const firstManager = await insertPerson({
      name: "Cycle A",
      email: uniqueEmail("cycle-a"),
      role: "manager",
    });
    const secondManager = await insertPerson({
      name: "Cycle B",
      email: uniqueEmail("cycle-b"),
      role: "manager",
    });

    const assigned = await reassignManager(PRIYA_ID, firstManager, secondManager);

    expect(assigned).toMatchObject({ changed: true, managerId: secondManager });

    const before = await auditCount(firstManager, "manager_reassigned");

    await expect(reassignManager(PRIYA_ID, secondManager, firstManager)).rejects.toMatchObject({
      status: 409,
    });

    // A rejected change writes no audit row.
    expect(await auditCount(secondManager, "manager_reassigned")).toBe(0);
    expect(await auditCount(firstManager, "manager_reassigned")).toBe(before);

    const noop = await reassignManager(PRIYA_ID, firstManager, secondManager);

    expect(noop).toMatchObject({ changed: false, auditWritten: false });
    expect(await auditCount(firstManager, "manager_reassigned")).toBe(before);

    const inactiveManager = await insertPerson({
      name: "Inactive Manager",
      email: uniqueEmail("inactive-manager"),
      role: "manager",
      isActive: false,
    });

    await expect(reassignManager(PRIYA_ID, firstManager, inactiveManager)).rejects.toMatchObject({
      status: 409,
    });

    const employee = await insertPerson({ email: uniqueEmail("employee-candidate") });

    await expect(reassignManager(PRIYA_ID, firstManager, employee)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("moves a pending request into the new manager's queue on reassignment", async () => {
    const previousManager = await insertPerson({
      name: "Queue Previous",
      email: uniqueEmail("queue-previous"),
      role: "manager",
    });
    const nextManager = await insertPerson({
      name: "Queue Next",
      email: uniqueEmail("queue-next"),
      role: "manager",
    });
    const owner = await insertPerson({
      name: "Queue Owner",
      email: uniqueEmail("queue-owner"),
      managerId: previousManager,
    });

    const [request] = await getDb()<{ id: string }[]>`
      insert into leave_requests (user_id, leave_type_id, start_date, end_date, reason, status)
      values (
        ${owner},
        ${VACATION_ID},
        date '2027-03-01',
        date '2027-03-02',
        'Queue handover check',
        'pending'
      )
      returning id
    `;

    const before = await listTeamLeaveRequests(previousManager);

    expect(before.map((row) => row.id)).toContain(request.id);

    await reassignManager(PRIYA_ID, owner, nextManager);

    const previousQueue = await listTeamLeaveRequests(previousManager);
    const nextQueue = await listTeamLeaveRequests(nextManager);

    expect(previousQueue.map((row) => row.id)).not.toContain(request.id);
    expect(nextQueue.map((row) => row.id)).toContain(request.id);
    // The request row itself is untouched: only the reporting line changed.
    expect(nextQueue.find((row) => row.id === request.id)?.status).toBe("pending");
  });

  it("blocks self-deactivation", async () => {
    const hrId = await insertPerson({
      name: "Temp HR",
      email: uniqueEmail("temp-hr"),
      role: "hr_admin",
    });

    try {
      await expect(setPersonActive(hrId, hrId, false, "Test")).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      // No audit row was written. Users are never hard-deleted (BR-04), so
      // deactivate the temporary identity directly to keep it out of counts.
      await getDb()`
        update users
        set is_active = false,
            deactivated_at = now()
        where id = ${hrId}
      `;
    }
  });

  it("blocks deactivating the last active HR admin", async (ctx) => {
    const [row] = await getDb()<{ count: number }[]>`
      select count(*)::int as count
      from users
      where role = 'hr_admin'
        and is_active = true
    `;

    if (row.count !== 1) {
      ctx.skip();
      return;
    }

    await expect(setPersonActive(DANIEL_ID, PRIYA_ID, false, "Test")).rejects.toMatchObject({
      status: 409,
    });

    const [priya] = await getDb()<{ is_active: boolean }[]>`
      select is_active from users where id = ${PRIYA_ID}
    `;
    expect(priya.is_active).toBe(true);
  });

  it("blocks deactivating a manager with active reports, then allows it once they move", async () => {
    const managerId = await insertPerson({
      name: "Guard Manager",
      email: uniqueEmail("guard-manager"),
      role: "manager",
    });
    const reportId = await insertPerson({
      name: "Guard Report",
      email: uniqueEmail("guard-report"),
      managerId,
    });

    await expect(
      setPersonActive(PRIYA_ID, managerId, false, "Team restructure"),
    ).rejects.toMatchObject({ status: 409 });

    await getDb()`
      update users
      set is_active = false,
          deactivated_at = now()
      where id = ${reportId}
    `;

    const deactivated = await setPersonActive(PRIYA_ID, managerId, false, "Team restructure");

    expect(deactivated).toMatchObject({ changed: true, isActive: false });

    const [row] = await getDb()<{ is_active: boolean; deactivated_at: Date | null }[]>`
      select is_active, deactivated_at from users where id = ${managerId}
    `;
    expect(row.is_active).toBe(false);
    expect(row.deactivated_at).not.toBeNull();

    const reactivated = await setPersonActive(PRIYA_ID, managerId, true);

    expect(reactivated).toMatchObject({ changed: true, isActive: true });

    const noop = await setPersonActive(PRIYA_ID, managerId, true);

    expect(noop).toMatchObject({ changed: false, auditWritten: false });
  });

  it("blocks reactivating a report whose manager is still inactive", async () => {
    const managerId = await insertPerson({
      name: "Inactive Manager",
      email: uniqueEmail("inactive-manager"),
      role: "manager",
    });
    const reportId = await insertPerson({
      name: "Inactive Report",
      email: uniqueEmail("inactive-report"),
      managerId,
    });

    // Deactivate the report first, then the now-reportless manager.
    await setPersonActive(PRIYA_ID, reportId, false, "Offboarding");
    await setPersonActive(PRIYA_ID, managerId, false, "Offboarding");

    await expect(setPersonActive(PRIYA_ID, reportId, true)).rejects.toMatchObject({
      status: 409,
    });

    const [row] = await getDb()<{ is_active: boolean }[]>`
      select is_active from users where id = ${reportId}
    `;
    expect(row.is_active).toBe(false);
  });

  it("imports a batch idempotently and rolls the whole batch back on failure", async () => {
    const firstEmail = uniqueEmail("import-one");
    const secondEmail = uniqueEmail("import-two");
    // A batch-local manager keeps the seeded reporting lines (Daniel's five
    // direct reports) untouched, so this suite stays rerunnable.
    const importManager = await insertPerson({
      name: "Import Manager",
      email: uniqueEmail("import-manager"),
      role: "manager",
    });
    const importManagerEmail = (
      await getDb()<{ email: string }[]>`select email from users where id = ${importManager}`
    )[0].email;

    const created = await bulkImportPeople(PRIYA_ID, [
      {
        name: "Import One",
        email: firstEmail,
        managerEmail: importManagerEmail,
        jobTitle: "Support Specialist",
        team: "Customer Success",
      },
      {
        name: "Import Two",
        email: secondEmail,
        managerEmail: null,
        jobTitle: null,
        team: null,
      },
    ]);

    expect(created).toEqual({ created: 2, updated: 0, skipped: 0 });

    const [first] = await getDb()<{ id: string; manager_id: string | null }[]>`
      select id, manager_id from users where lower(email) = lower(${firstEmail})
    `;
    expect(first.manager_id).toBe(importManager);
    expect(await auditCount(first.id, "imported")).toBe(1);

    const repeated = await bulkImportPeople(PRIYA_ID, [
      {
        name: "Import One",
        email: firstEmail,
        managerEmail: importManagerEmail,
        jobTitle: "Support Specialist",
        team: "Customer Success",
      },
      {
        name: "Import Two",
        email: secondEmail,
        managerEmail: null,
        jobTitle: null,
        team: null,
      },
    ]);

    expect(repeated).toEqual({ created: 0, updated: 0, skipped: 2 });
    expect(await auditCount(first.id, "imported")).toBe(1);

    const changed = await bulkImportPeople(PRIYA_ID, [
      {
        name: "Import One",
        email: firstEmail,
        managerEmail: importManagerEmail,
        jobTitle: "Support Specialist",
        team: "Support",
      },
    ]);

    expect(changed).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(await auditCount(first.id, "imported")).toBe(2);

    const rollbackEmail = uniqueEmail("import-rollback");
    const badEmail = uniqueEmail("import-bad");

    await expect(
      bulkImportPeople(PRIYA_ID, [
        {
          name: "Rollback Row",
          email: rollbackEmail,
          managerEmail: null,
          jobTitle: null,
          team: null,
        },
        {
          name: "Bad Row",
          email: badEmail,
          managerEmail: "missing.manager@leavetrack.demo",
          jobTitle: null,
          team: null,
        },
      ]),
    ).rejects.toMatchObject({ status: 400 });

    const [rolledBack] = await getDb()<{ id: string }[]>`
      select id from users where lower(email) = lower(${rollbackEmail})
    `;
    expect(rolledBack).toBeUndefined();
  });

  it("leaves omitted optional fields unchanged and clears them only when null", async () => {
    const manager = await insertPerson({
      name: "Partial Manager",
      email: uniqueEmail("partial-manager"),
      role: "manager",
    });
    const [managerRow] = await getDb()<{ email: string }[]>`
      select email from users where id = ${manager}
    `;
    const ownerEmail = uniqueEmail("partial-owner");

    await bulkImportPeople(PRIYA_ID, [
      {
        name: "Partial Owner",
        email: ownerEmail,
        managerEmail: managerRow.email,
        jobTitle: "Engineer",
        team: "Platform",
      },
    ]);

    const [before] = await getDb()<
      {
        id: string;
        manager_id: string | null;
        job_title: string | null;
        team: string | null;
      }[]
    >`
      select id, manager_id, job_title, team
      from users
      where lower(email) = lower(${ownerEmail})
    `;

    expect(before.manager_id).toBe(manager);
    expect(before.job_title).toBe("Engineer");
    expect(before.team).toBe("Platform");

    // A partial row updates only the name; the omitted fields must survive.
    const renamed = await bulkImportPeople(PRIYA_ID, [
      { name: "Partial Owner Renamed", email: ownerEmail },
    ]);

    expect(renamed).toEqual({ created: 0, updated: 1, skipped: 0 });

    const [unchanged] = await getDb()<
      {
        name: string;
        manager_id: string | null;
        job_title: string | null;
        team: string | null;
      }[]
    >`
      select name, manager_id, job_title, team from users where id = ${before.id}
    `;

    expect(unchanged.name).toBe("Partial Owner Renamed");
    expect(unchanged.manager_id).toBe(manager);
    expect(unchanged.job_title).toBe("Engineer");
    expect(unchanged.team).toBe("Platform");
    expect(await auditCount(before.id, "imported")).toBe(2);

    // An explicit null is the only way to clear a stored value.
    await bulkImportPeople(PRIYA_ID, [
      { name: "Partial Owner Renamed", email: ownerEmail, managerEmail: null, team: null },
    ]);

    const [cleared] = await getDb()<
      {
        manager_id: string | null;
        job_title: string | null;
        team: string | null;
      }[]
    >`
      select manager_id, job_title, team from users where id = ${before.id}
    `;

    expect(cleared.manager_id).toBeNull();
    expect(cleared.job_title).toBe("Engineer");
    expect(cleared.team).toBeNull();
    expect(await auditCount(before.id, "imported")).toBe(3);
  });

  it("resolves a manager created earlier in the same batch", async () => {
    const managerEmail = uniqueEmail("batch-manager");
    const reportEmail = uniqueEmail("batch-report");

    const result = await bulkImportPeople(PRIYA_ID, [
      { name: "Batch Manager", email: managerEmail, role: "manager" },
      { name: "Batch Report", email: reportEmail, managerEmail },
    ]);

    expect(result).toEqual({ created: 2, updated: 0, skipped: 0 });

    const [manager] = await getDb()<{ id: string }[]>`
      select id from users where lower(email) = lower(${managerEmail})
    `;
    const [report] = await getDb()<{ manager_id: string | null }[]>`
      select manager_id from users where lower(email) = lower(${reportEmail})
    `;

    expect(report.manager_id).toBe(manager.id);
  });

  it("persists a case-only email correction on a linked row", async () => {
    const subjectId = await insertPerson({
      name: "Case Person",
      email: uniqueEmail("case-person"),
    });
    const [before] = await getDb()<{ email: string }[]>`
      select email from users where id = ${subjectId}
    `;

    await getDb()`
      update users set auth_subject = ${randomUUID()} where id = ${subjectId}
    `;

    const result = await updatePersonProfile(PRIYA_ID, subjectId, {
      name: "Case Person",
      email: before.email.toUpperCase(),
      jobTitle: null,
      team: null,
    });

    expect(result).toMatchObject({ changed: true, auditWritten: true });

    const [after] = await getDb()<{ email: string }[]>`
      select email from users where id = ${subjectId}
    `;

    expect(after.email).toBe(before.email.toUpperCase());
  });

  it("returns the recent people audit entries newest first with actor and subject names", async () => {
    const entries = await listPersonAudit(20);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty("actorName");
    expect(entries[0]).toHaveProperty("subjectName");
    expect(new Date(entries[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(entries[entries.length - 1].createdAt).getTime(),
    );
  });
});

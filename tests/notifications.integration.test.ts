import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import {
  createLeaveRequest,
  decideLeaveRequest,
  listLeaveTypes,
  overrideLeaveRequest,
} from "@/lib/db/leave";
import {
  claimPendingEmails,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  MAX_EMAIL_ATTEMPTS,
} from "@/lib/db/notifications";
import { EmailNotConfiguredError, type EmailTransport } from "@/lib/notifications/email";
import { runNotificationOutbox } from "@/lib/notifications/worker";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const DANIEL_ID = "a0000000-0000-4000-8000-000000000001";
const PRIYA_ID = "a0000000-0000-4000-8000-000000000003";
const MAYA_ID = "a0000000-0000-4000-8000-000000000004";

interface NotificationRow {
  id: string;
  recipient_id: string;
  event_type: string;
  channel: string;
  status: string;
  subject: string;
  body: string;
  attempts: number;
  next_attempt_at: Date | null;
  read_at: Date | null;
}

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

async function rowsFor(requestId: string): Promise<NotificationRow[]> {
  return getDb()<NotificationRow[]>`
    select
      id,
      recipient_id,
      event_type,
      channel,
      status,
      subject,
      body,
      attempts,
      next_attempt_at,
      read_at
    from notifications
    where leave_request_id = ${requestId}
    order by channel, event_type
  `;
}

async function makeDue(notificationId: string, attempts = 0): Promise<void> {
  await getDb()`
    update notifications
    set status = 'pending',
        attempts = ${attempts},
        next_attempt_at = null,
        last_error = null
    where id = ${notificationId}
  `;
}

function fakeTransport(behaviour: "ok" | "fail" | "unconfigured"): EmailTransport & {
  sent: string[];
} {
  const sent: string[] = [];

  return {
    name: behaviour,
    sent,
    async send(message) {
      if (behaviour === "fail") {
        throw new Error("The provider is unavailable.");
      }

      if (behaviour === "unconfigured") {
        throw new EmailNotConfiguredError();
      }

      sent.push(message.subject);
    },
  };
}

describe.skipIf(!hasDatabase)("notification outbox integration", () => {
  const createdRequests: string[] = [];
  const createdPeople: string[] = [];
  let vacationId = "";
  let unpaidId = "";

  afterAll(async () => {
    if (!hasDatabase) {
      return;
    }

    for (const id of createdRequests) {
      await getDb()`update leave_requests set is_deleted = true where id = ${id}`;
    }

    // Users are never hard-deleted (BR-04); deactivate the temporary rows.
    for (const id of createdPeople) {
      await getDb()`
        update users
        set is_active = false,
            deactivated_at = coalesce(deactivated_at, now())
        where id = ${id}
      `;
    }

    await getDb().end({ timeout: 5 });
  });

  it("notifies the manager on submission without notifying the employee", async () => {
    const types = await listLeaveTypes();
    vacationId = types.find((type) => type.name === "Vacation")?.id ?? "";
    unpaidId = types.find((type) => type.name === "Unpaid")?.id ?? "";
    expect(vacationId).toBeTruthy();
    expect(unpaidId).toBeTruthy();

    const result = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: vacationId,
      startDate: "2033-04-04",
      endDate: "2033-04-06",
      reason: "Notification integration submission.",
    });
    createdRequests.push(result.request.id);

    const rows = await rowsFor(result.request.id);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.channel).sort()).toEqual(["email", "in_app"]);
    expect(rows.every((row) => row.recipient_id === DANIEL_ID)).toBe(true);
    expect(rows.every((row) => row.event_type === "request_submitted")).toBe(true);
    expect(rows.find((row) => row.channel === "in_app")?.status).toBe("sent");
    expect(rows.find((row) => row.channel === "email")?.status).toBe("pending");
    expect(rows[0]?.body).toContain("Maya Chen");
    expect(rows[0]?.body).toContain("Notification integration submission.");
  });

  it("notifies the employee when a manager approves", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: unpaidId,
      startDate: "2033-05-02",
      endDate: "2033-05-02",
      reason: "Notification integration approval.",
    });
    createdRequests.push(created.request.id);

    await decideLeaveRequest({
      requestId: created.request.id,
      managerId: DANIEL_ID,
      managerName: "Daniel Okafor",
      decision: "approved",
    });

    const rows = await rowsFor(created.request.id);
    const decisionRows = rows.filter((row) => row.event_type === "request_approved");

    expect(decisionRows).toHaveLength(2);
    expect(decisionRows.every((row) => row.recipient_id === MAYA_ID)).toBe(true);
    expect(decisionRows[0]?.subject).toBe("Your Unpaid request was approved");
    expect(decisionRows[0]?.body).toContain("approved by Daniel Okafor");
  });

  it("notifies the employee when a manager rejects, with the reason", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: unpaidId,
      startDate: "2033-06-02",
      endDate: "2033-06-02",
      reason: "Notification integration rejection.",
    });
    createdRequests.push(created.request.id);

    await decideLeaveRequest({
      requestId: created.request.id,
      managerId: DANIEL_ID,
      managerName: "Daniel Okafor",
      decision: "rejected",
      reason: "Coverage gap that week",
    });

    const decisionRows = (await rowsFor(created.request.id)).filter(
      (row) => row.event_type === "request_rejected",
    );

    expect(decisionRows).toHaveLength(2);
    expect(decisionRows.every((row) => row.recipient_id === MAYA_ID)).toBe(true);
    expect(decisionRows[0]?.body).toContain("Coverage gap that week.");
  });

  it("notifies the employee on an HR override and marks it as one", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: unpaidId,
      startDate: "2033-07-04",
      endDate: "2033-07-04",
      reason: "Notification integration override.",
    });
    createdRequests.push(created.request.id);

    await overrideLeaveRequest({
      requestId: created.request.id,
      actorId: PRIYA_ID,
      actorName: "Priya Nair",
      decision: "approved",
      reason: "HR documented exception",
    });

    const decisionRows = (await rowsFor(created.request.id)).filter(
      (row) => row.event_type === "request_approved",
    );

    expect(decisionRows).toHaveLength(2);
    expect(decisionRows[0]?.body).toContain("HR (Priya Nair)");
    expect(decisionRows[0]?.body).toContain("as an override");
  });

  it("does not duplicate the employee notification when a decision is replayed", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: unpaidId,
      startDate: "2033-08-01",
      endDate: "2033-08-01",
      reason: "Notification integration duplicate.",
    });
    createdRequests.push(created.request.id);

    await decideLeaveRequest({
      requestId: created.request.id,
      managerId: DANIEL_ID,
      managerName: "Daniel Okafor",
      decision: "approved",
    });

    await expect(
      decideLeaveRequest({
        requestId: created.request.id,
        managerId: DANIEL_ID,
        managerName: "Daniel Okafor",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ status: 409 });

    const decisionRows = (await rowsFor(created.request.id)).filter(
      (row) => row.event_type === "request_approved",
    );

    expect(decisionRows).toHaveLength(2);
  });

  it("routes a managerless submission to the active HR admins", async () => {
    const employeeId = await insertPerson({
      name: "No Manager",
      email: uniqueEmail("no-manager"),
    });
    createdPeople.push(employeeId);

    const created = await createLeaveRequest({
      userId: employeeId,
      leaveTypeId: vacationId,
      startDate: "2033-09-05",
      endDate: "2033-09-05",
      reason: "No manager fallback.",
    });
    createdRequests.push(created.request.id);

    expect(created.managerNotified).toBe(false);

    const rows = await rowsFor(created.request.id);
    const recipients = [...new Set(rows.map((row) => row.recipient_id))];

    expect(rows).toHaveLength(2);
    expect(recipients).toContain(PRIYA_ID);

    const [role] = await getDb()<{ role: string }[]>`
      select role::text as role from users where id = ${recipients[0]}
    `;
    expect(role?.role).toBe("hr_admin");
  });

  it("skips a recipient who has been deactivated", async () => {
    const managerId = await insertPerson({
      name: "Inactive Manager",
      email: uniqueEmail("inactive-manager"),
      role: "manager",
      isActive: false,
    });
    createdPeople.push(managerId);

    const employeeId = await insertPerson({
      name: "Report Of Inactive",
      email: uniqueEmail("report-inactive"),
      managerId,
    });
    createdPeople.push(employeeId);

    const created = await createLeaveRequest({
      userId: employeeId,
      leaveTypeId: vacationId,
      startDate: "2033-10-03",
      endDate: "2033-10-03",
      reason: "Inactive recipient scope.",
    });
    createdRequests.push(created.request.id);

    expect(await rowsFor(created.request.id)).toHaveLength(0);
  });

  it("lists only the recipient's in-app rows and refuses a foreign read", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: unpaidId,
      startDate: "2033-11-07",
      endDate: "2033-11-07",
      reason: "Notification list scoping.",
    });
    createdRequests.push(created.request.id);

    await decideLeaveRequest({
      requestId: created.request.id,
      managerId: DANIEL_ID,
      managerName: "Daniel Okafor",
      decision: "rejected",
      reason: "Scoping check",
    });

    const decisionRow = (await rowsFor(created.request.id)).find(
      (row) => row.channel === "in_app" && row.event_type === "request_rejected",
    );
    const submissionRow = (await rowsFor(created.request.id)).find(
      (row) => row.channel === "in_app" && row.event_type === "request_submitted",
    );

    expect(decisionRow).toBeDefined();
    expect(submissionRow).toBeDefined();

    const decisionNotificationId = decisionRow?.id ?? "";
    const submissionNotificationId = submissionRow?.id ?? "";

    const mine = await listNotifications(MAYA_ID);
    expect(mine.items.map((item) => item.id)).toContain(decisionNotificationId);

    const theirs = await listNotifications(DANIEL_ID);
    expect(theirs.items.map((item) => item.id)).not.toContain(decisionNotificationId);
    expect(theirs.items.map((item) => item.id)).toContain(submissionNotificationId);

    // A foreign id updates nothing and reads as missing.
    expect(await markNotificationRead(DANIEL_ID, decisionNotificationId)).toBeNull();

    const readAt = await markNotificationRead(MAYA_ID, decisionNotificationId);
    expect(readAt).not.toBeNull();
    expect(await markNotificationRead(MAYA_ID, decisionNotificationId)).toBeNull();

    const [row] = await getDb()<{ read_at: Date | null }[]>`
      select read_at from notifications where id = ${decisionNotificationId}
    `;
    expect(row?.read_at).not.toBeNull();
  });

  it("marks every unread in-app row for one recipient", async () => {
    const [before] = await getDb()<{ count: number }[]>`
      select count(*)::int as count
      from notifications
      where recipient_id = ${DANIEL_ID}
        and channel = 'in_app'
        and read_at is null
    `;

    expect(before?.count ?? 0).toBeGreaterThan(0);

    const updated = await markAllNotificationsRead(DANIEL_ID);
    expect(updated).toBeGreaterThan(0);

    const [after] = await getDb()<{ count: number }[]>`
      select count(*)::int as count
      from notifications
      where recipient_id = ${DANIEL_ID}
        and channel = 'in_app'
        and read_at is null
    `;
    expect(after?.count).toBe(0);
  });

  it("delivers a pending email once and never resends it", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: vacationId,
      startDate: "2033-12-05",
      endDate: "2033-12-05",
      reason: "Outbox success path.",
    });
    createdRequests.push(created.request.id);

    const emailRow = (await rowsFor(created.request.id)).find((row) => row.channel === "email");
    expect(emailRow).toBeDefined();
    const emailRowId = emailRow?.id ?? "";

    // Earlier suites leave pending email rows behind, and the worker caps each
    // run. Park everything except this request's row so the assertion is about
    // this row, not about backlog order.
    await getDb()`
      update notifications
      set next_attempt_at = now() + interval '1 hour'
      where channel = 'email'
        and status in ('pending', 'failed')
        and id <> ${emailRowId}
    `;

    const transport = fakeTransport("ok");
    const first = await runNotificationOutbox(transport);

    expect(first).toEqual({ processed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(transport.sent.length).toBe(1);

    const [sentRow] = await getDb()<{ status: string; attempts: number; sent_at: Date | null }[]>`
      select status, attempts, sent_at from notifications where id = ${emailRowId}
    `;
    expect(sentRow).toMatchObject({ status: "sent", attempts: 1 });
    expect(sentRow?.sent_at).not.toBeNull();

    const second = await runNotificationOutbox(transport);
    expect(second).toEqual({ processed: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it("retries a failed send and succeeds on the next run", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: vacationId,
      startDate: "2034-01-09",
      endDate: "2034-01-09",
      reason: "Outbox retry path.",
    });
    createdRequests.push(created.request.id);

    const emailRow = (await rowsFor(created.request.id)).find((row) => row.channel === "email");
    const emailRowId = emailRow?.id ?? "";
    await makeDue(emailRowId);

    await runNotificationOutbox(fakeTransport("fail"));

    const [failedRow] = await getDb()<
      { status: string; attempts: number; next_attempt_at: Date }[]
    >`
      select status, attempts, next_attempt_at
      from notifications
      where id = ${emailRowId}
    `;

    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.attempts).toBe(1);
    expect(failedRow?.next_attempt_at).not.toBeNull();

    await makeDue(emailRowId, 1);
    const transport = fakeTransport("ok");
    await runNotificationOutbox(transport);

    const [sentRow] = await getDb()<{ status: string; attempts: number }[]>`
      select status, attempts from notifications where id = ${emailRowId}
    `;
    expect(sentRow).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("stops retrying after the attempt cap", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: vacationId,
      startDate: "2034-02-06",
      endDate: "2034-02-06",
      reason: "Outbox terminal path.",
    });
    createdRequests.push(created.request.id);

    const emailRow = (await rowsFor(created.request.id)).find((row) => row.channel === "email");
    const emailRowId = emailRow?.id ?? "";
    await makeDue(emailRowId, MAX_EMAIL_ATTEMPTS - 1);

    await runNotificationOutbox(fakeTransport("fail"));

    const [row] = await getDb()<
      { status: string; attempts: number; next_attempt_at: Date | null }[]
    >`
      select status, attempts, next_attempt_at
      from notifications
      where id = ${emailRowId}
    `;

    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(MAX_EMAIL_ATTEMPTS);
    expect(row?.next_attempt_at).toBeNull();
  });

  it("skips delivery when the transport is not configured", async () => {
    const created = await createLeaveRequest({
      userId: MAYA_ID,
      leaveTypeId: vacationId,
      startDate: "2034-03-06",
      endDate: "2034-03-06",
      reason: "Outbox unconfigured path.",
    });
    createdRequests.push(created.request.id);

    const emailRow = (await rowsFor(created.request.id)).find((row) => row.channel === "email");
    const emailRowId = emailRow?.id ?? "";
    await makeDue(emailRowId);

    const result = await runNotificationOutbox(fakeTransport("unconfigured"));
    expect(result.skipped).toBeGreaterThan(0);

    const [row] = await getDb()<
      { status: string; next_attempt_at: Date | null; last_error: string }[]
    >`
      select status, next_attempt_at, last_error
      from notifications
      where id = ${emailRowId}
    `;

    expect(row?.status).toBe("skipped");
    expect(row?.next_attempt_at).toBeNull();
    expect(row?.last_error).toContain("not configured");
  });

  it("leases at most the requested batch size", async () => {
    // Reset more rows than the batch size so a re-evaluated IN(subquery) would
    // over-claim; the materialized CTE must honor the cap exactly.
    const seeded = await getDb()<{ id: string }[]>`
      update notifications
      set status = 'pending',
          next_attempt_at = null,
          attempts = 0
      where id in (
        select id
        from notifications
        where channel = 'email'
        order by created_at
        limit 6
      )
      returning id
    `;
    expect(seeded).toHaveLength(6);

    const claimed = await claimPendingEmails(3);
    expect(claimed).toHaveLength(3);
  });
});

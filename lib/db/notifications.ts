import "server-only";

import type { TransactionSql } from "postgres";

import { getDb } from "@/lib/db/client";
import type {
  NotificationEventType,
  NotificationItem,
  NotificationListResult,
  NotificationStatus,
} from "@/lib/types";

/** Delivery attempts before a failed email becomes terminal. */
export const MAX_EMAIL_ATTEMPTS = 5;

export interface NotificationEvent {
  recipientId: string;
  actorId: string | null;
  leaveRequestId: string;
  eventType: NotificationEventType;
  subject: string;
  body: string;
  /** Designed email markup; absent for in-app rows and pre-design outbox rows. */
  htmlBody?: string | null;
}

interface NotificationRow {
  id: string;
  event_type: NotificationEventType;
  subject: string;
  body: string;
  leave_request_id: string;
  read_at: Date | null;
  created_at: Date;
}

interface PendingEmailRow {
  id: string;
  subject: string;
  body: string;
  html_body: string | null;
  recipient_email: string;
}

export interface PendingEmail {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  htmlBody: string | null;
}

export interface EmailResultOptions {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

function toNotificationItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    eventType: row.event_type,
    subject: row.subject,
    body: row.body,
    leaveRequestId: row.leave_request_id,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Writes the outbox rows for one event. Must be called with the caller's
 * transaction so the notification commits or rolls back with the request or
 * decision it describes. No provider call happens here.
 *
 * `in_app` rows are immediately readable (status 'sent'); `email` rows start
 * 'pending' and are claimed by the cron worker. The unique key makes a repeated
 * event a no-op, and inactive recipients are skipped because they cannot sign in.
 */
export async function enqueueNotifications(
  tx: TransactionSql,
  events: NotificationEvent[],
): Promise<number> {
  let inserted = 0;

  for (const event of events) {
    const inApp = await tx<{ id: string }[]>`
      insert into notifications (
        recipient_id,
        actor_id,
        leave_request_id,
        event_type,
        channel,
        status,
        subject,
        body,
        sent_at
      )
      select
        ${event.recipientId},
        ${event.actorId},
        ${event.leaveRequestId},
        ${event.eventType},
        'in_app',
        'sent',
        ${event.subject},
        ${event.body},
        now()
      where exists (
        select 1 from users where id = ${event.recipientId} and is_active = true
      )
      on conflict (event_type, leave_request_id, recipient_id, channel) do nothing
      returning id
    `;

    const email = await tx<{ id: string }[]>`
      insert into notifications (
        recipient_id,
        actor_id,
        leave_request_id,
        event_type,
        channel,
        status,
        subject,
        body,
        html_body
      )
      select
        ${event.recipientId},
        ${event.actorId},
        ${event.leaveRequestId},
        ${event.eventType},
        'email',
        'pending',
        ${event.subject},
        ${event.body},
        ${event.htmlBody ?? null}
      where exists (
        select 1 from users where id = ${event.recipientId} and is_active = true
      )
      on conflict (event_type, leave_request_id, recipient_id, channel) do nothing
      returning id
    `;

    inserted += inApp.length + email.length;
  }

  return inserted;
}

/** Recipient-scoped list; the caller passes the session id, never a body value. */
export async function listNotifications(
  recipientId: string,
  { limit = 50 }: { limit?: number } = {},
): Promise<NotificationListResult> {
  const [rows, countRows] = await Promise.all([
    getDb()<NotificationRow[]>`
      select id, event_type, subject, body, leave_request_id, read_at, created_at
      from notifications
      where recipient_id = ${recipientId}
        and channel = 'in_app'
      order by created_at desc
      limit ${limit}
    `,
    getDb()<{ count: number }[]>`
      select count(*)::int as count
      from notifications
      where recipient_id = ${recipientId}
        and channel = 'in_app'
        and read_at is null
    `,
  ]);

  return {
    items: rows.map(toNotificationItem),
    unreadCount: countRows[0]?.count ?? 0,
  };
}

export async function countUnreadNotifications(
  recipientId: string,
  signal?: AbortSignal,
): Promise<number> {
  const [row] = await getDb()<{ count: number }[]>`
    select count(*)::int as count
    from notifications
    where recipient_id = ${recipientId}
      and channel = 'in_app'
      and read_at is null
  `.signal(signal);

  return row?.count ?? 0;
}

/**
 * Ownership is part of the predicate, so a foreign id updates nothing and the
 * route answers 404 without revealing whether the row exists.
 */
export async function markNotificationRead(
  recipientId: string,
  notificationId: string,
): Promise<string | null> {
  const [row] = await getDb()<{ read_at: Date }[]>`
    update notifications
    set read_at = now()
    where id = ${notificationId}
      and recipient_id = ${recipientId}
      and channel = 'in_app'
      and read_at is null
    returning read_at
  `;

  return row?.read_at.toISOString() ?? null;
}

export async function markAllNotificationsRead(recipientId: string): Promise<number> {
  const rows = await getDb()<{ id: string }[]>`
    update notifications
    set read_at = now()
    where recipient_id = ${recipientId}
      and channel = 'in_app'
      and read_at is null
    returning id
  `;

  return rows.length;
}

/**
 * Atomically leases a batch of due email rows and returns their recipients.
 * The lease (`next_attempt_at`) is what stops two overlapping cron runs from
 * delivering the same message; `skip locked` keeps them from blocking.
 *
 * The `materialized` CTE is load-bearing: an `IN (subquery ... limit n)` is
 * re-evaluated per outer row once it contains `for update`, which silently
 * defeats the batch cap. The CTE evaluates the ordered, locked, limited set
 * exactly once, so a backlog drains across runs instead of in one invocation.
 */
export async function claimPendingEmails(limit = 25): Promise<PendingEmail[]> {
  const rows = await getDb()<PendingEmailRow[]>`
    with due as materialized (
      select id
      from notifications
      where channel = 'email'
        and status in ('pending', 'failed')
        and attempts < ${MAX_EMAIL_ATTEMPTS}
        and (next_attempt_at is null or next_attempt_at <= now())
      order by created_at
      limit ${limit}
      for update skip locked
    )
    update notifications n
    set next_attempt_at = now() + interval '10 minutes'
    from due, users u
    where n.id = due.id
      and u.id = n.recipient_id
    returning
      n.id,
      n.subject,
      n.body,
      n.html_body,
      u.email as recipient_email
  `;

  return rows.map((row) => ({
    id: row.id,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    body: row.body,
    htmlBody: row.html_body,
  }));
}

/**
 * Records one attempt. Success is terminal; a failure either schedules an
 * exponential retry or, once the cap is reached, becomes terminal 'failed'.
 * A transport-configuration problem is terminal 'skipped' so it cannot burn
 * retries on something no attempt can fix.
 */
export async function recordEmailResult(
  notificationId: string,
  options: EmailResultOptions,
): Promise<NotificationStatus> {
  if (options.ok) {
    await getDb()`
      update notifications
      set status = 'sent',
          attempts = attempts + 1,
          sent_at = now(),
          last_error = null,
          next_attempt_at = null
      where id = ${notificationId}
    `;

    return "sent";
  }

  const skipped = options.skipped ?? false;

  const [row] = await getDb()<{ status: NotificationStatus }[]>`
    update notifications
    set status = ${skipped ? "skipped" : "failed"},
        attempts = attempts + 1,
        last_error = ${options.error ?? "Delivery failed."},
        next_attempt_at = case
          when ${skipped}::boolean or attempts + 1 >= ${MAX_EMAIL_ATTEMPTS} then null
          else now() + least(power(2, attempts + 1), 60) * interval '1 minute'
        end
    where id = ${notificationId}
    returning status
  `;

  return row?.status ?? (skipped ? "skipped" : "failed");
}

# Notification outbox pattern

E2-10 / `ADR-LeaveTrack-E2-10-Notifications`. Submission and decision notifications use a single
durable outbox with two channels. This is the checklist for any change to that surface.

## Invariants

- **The event and its notifications commit together.** `enqueueNotifications(tx, …)` is called
  with the same transaction as the request insert or decision update. Never enqueue after the
  transaction returns, and never send from inside it.
- **The outbox is the record.** In-app delivery is not "the message happened to render"; it is a
  row with `channel = 'in_app'` and `status = 'sent'`. Email has its own row with the same subject
  and body.
- **One row per event, request, recipient, and channel.** The unique key is
  `(event_type, leave_request_id, recipient_id, channel)`. Inserts use `on conflict … do nothing`;
  restore must not rewrite a delivered row.
- **Providers are only called by the worker.** `lib/db/notifications.ts` imports no transport and
  the routes never send email.

## Enqueue rules

- `createLeaveRequest` notifies the owner's manager. With `manager_id is null`, notify every active
  `hr_admin` (`resolveSubmissionRecipients`). The submitter is never notified of their own
  submission, and `managerNotified` stays `manager_id !== null`.
- `applyDecision` (manager decision and HR override, both through the shared helper) notifies the
  request owner. Copy distinguishes an HR override.
- Recipients must be resolved in SQL, never from the request body. An inactive recipient is skipped
  by the insert's `exists (select 1 from users where id = … and is_active = true)` guard.
- Copy comes from `buildNotificationCopy`; both channels share one message. Do not fork the
  wording between the in-app row and the email.

## Delivery rules

- `claimPendingEmails()` leases due rows with `for update skip locked` and sets `next_attempt_at`
  ten minutes ahead. Keep the lease; it is what stops overlapping cron runs from double-sending.
- `recordEmailResult`:
  - success → `sent`, `sent_at = now()`, attempts incremented, `next_attempt_at = null`;
  - failure → `failed`, backoff `2^attempts` minutes (capped at 60), terminal after
    `MAX_EMAIL_ATTEMPTS = 5`;
  - `EmailNotConfiguredError` → `skipped`, no retry. A missing credential will not fix itself.
- Bump `MAX_EMAIL_ATTEMPTS` only together with the backoff cap and the partial queue index.
- `/api/jobs/notifications` is a system route: public in `proxy.ts`, protected by
  `Authorization: Bearer $CRON_SECRET` with a constant-time compare. Both GET and POST run the same
  handler because Vercel Cron uses GET. Return 503 when the secret is unset, 401 on a bad header.
- The worker must run outside a transaction and record each attempt on its own, so a slow provider
  cannot hold a database lock.

## Transport rules

- `EMAIL_TRANSPORT=log` is the default and must keep working with an empty environment. It contacts
  nobody and logs no recipient address.
- `EMAIL_TRANSPORT=resend` uses `fetch`; there is no SDK dependency to add. `EMAIL_API_KEY` and
  `EMAIL_FROM` are server-only. A missing value makes the adapter throw `EmailNotConfiguredError`,
  which the worker records as `skipped`.
- A new transport implements `EmailTransport { name; send(message) }` and is selected inside
  `resolveEmailTransport()`, so tests can inject a fake without environment variables.

## Read rules

- `listNotifications(recipientId)` returns only `in_app` rows for that recipient, newest first.
- `markNotificationRead(recipientId, id)` and `markAllNotificationsRead(recipientId)` include the
  recipient in the `where` clause. A foreign id updates nothing; the route answers 404, never 403,
  so it does not reveal that the row exists.
- The recipient is always the session id. There is no `userId` query parameter.
- The unread badge in `app/(app)/layout.tsx` swallows a database error as zero. Keep the badge
  decorative; the `/notifications` page reports the real error.

## Database policy

- Migration `0006_notifications.sql` grants `leavetrack_app` `SELECT/INSERT/UPDATE` only. There is
  no `DELETE` and no `TRUNCATE`.
- `anon`/`authenticated` receive the restrictive deny policy and no grants (ADR-LeaveTrack-E005).
- `notifications_set_updated_at` keeps `updated_at` honest; `notifications_no_hard_delete` keeps
  the table append-only at the database boundary. Do not add a cleanup delete path.
- The worker scan relies on the partial index
  `(next_attempt_at, created_at) where channel = 'email' and status in ('pending','failed')`. Keep
  the claim predicate matching it.

## Tests that must exist

1. A submission writes exactly one `in_app` (sent) and one `email` (pending) row for the manager,
   and the body carries the reason.
2. A managerless submission reaches the active `hr_admin` and leaves `managerNotified` false.
3. An inactive recipient produces no row at all.
4. Approve, reject, and HR override each write two rows to the owner; the reject body carries the
   reason and the override body says "HR (…)".
5. A replayed decision (409) adds no second notification row.
6. `listNotifications` is recipient-scoped; a foreign read returns 404 and changes nothing; a second
   read of the same row is null.
7. `markAllNotificationsRead` clears only the caller's unread rows.
8. The worker sends a pending row once and does not resend it on the next run.
9. A failed send is retried, and the attempt cap leaves a terminal `failed` row with no
   `next_attempt_at`.
10. An unconfigured transport produces `skipped`, not an endless retry.

## Test isolation

- Notifications are append-only (`prevent_hard_delete`), so `test:db` must not try to delete them.
  Assert per request and per recipient, never a global table count.
- Temporary users are deactivated rather than deleted. Temporary requests are soft-deleted.
- Run `npm run test:db` a second time on the same database; it must pass unchanged.

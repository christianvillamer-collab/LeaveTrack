# ADR-LeaveTrack-E2-10 — Notification Outbox

**Status:** Accepted — submission and decision notifications ship in E2-10 with a durable outbox,
an in-app inbox, and a swappable email adapter.

## Context

US-01 AC1 requires the manager to be notified when a request is submitted, and US-03 requires the
employee to be told when it is approved or rejected. Until E2-10, "notification" was only implicit:
the pending row's `manager_id` made it visible in the manager's `/approvals` queue, and a decision
changed the row's status. There was no message, no record that anyone was told, and no place for a
second channel to plug in.

Three constraints shape the design:

1. **No new dependency.** The stack has no email SDK, and adding one for a single HTTP call is not
   worth the supply-chain and bundle cost. An adapter over `fetch` is enough.
2. **Delivery must not be able to fail a decision.** A rejected provider call cannot roll back an
   approved request. The database write and the outbound send must be separable.
3. **Replays must be safe.** `POST /api/leave-requests` can be retried, the decision routes already
   answer a duplicate with 409, and the cron job can overlap with itself. A notification must be
   created exactly once per event.

## Decision

### 1. One outbox table, two channels

`notifications` is the single durable record for both `in_app` and `email` delivery:

```
notifications (
  id, recipient_id, actor_id, leave_request_id,
  event_type, channel, status, subject, body,
  attempts, next_attempt_at, last_error, sent_at, read_at,
  created_at, updated_at,
  unique (event_type, leave_request_id, recipient_id, channel)
)
```

`event_type` is `request_submitted | request_approved | request_rejected`; `channel` is
`in_app | email`; `status` is `pending | sent | failed | skipped`.

The unique key is the idempotency contract, in the same spirit as `accrual_ledger`: a duplicated
submit, a duplicated cron run, or a concurrent duplicate decision can never produce a second
notification for the same event, request, recipient, and channel. The insert uses
`on conflict … do nothing`, not an upsert — a replay must not rewrite a delivered row.

### 2. Writes happen inside the caller's transaction

`enqueueNotifications(tx, events)` is called from `createLeaveRequest` and `applyDecision` with the
transaction that writes the request/decision and its audit row. The outbox row commits or rolls
back with the event it describes. **No provider call happens here.** A submission can never succeed
with a lost notification, and a notification can never exist for a request that did not commit.

`in_app` rows are inserted as `sent` with `sent_at = now()`: they are readable immediately and have
nothing to deliver. `email` rows are inserted as `pending` and left for the worker.

### 3. Recipients come from SQL, never the body

- **Submission:** the owner's `manager_id`. With no manager, every active `hr_admin` is notified;
  this matches the existing "HR review — no manager is assigned" copy on the submit screen. The
  employee is not notified of their own submission.
- **Decision (manager or HR override):** the request owner.
- A recipient with `is_active = false` is skipped by an `exists (… and is_active = true)` guard in
  the insert, because an inactive account cannot sign in to read the message.

`managerNotified` keeps its existing meaning (`manager_id !== null`); the HR fallback does not
change the submit response.

### 4. Copy is built once and shared by both channels

`buildNotificationCopy` in `lib/notifications/templates.ts` is a pure function. The in-app row and
the email carry the same subject and body, so they cannot drift. The copy names the employee, the
leave type, the inclusive date range, the day count, the reason/note when present, and marks an HR
override explicitly (`HR (Priya Nair) … as an override`).

### 5. Email delivery is a cron worker, not a request

`GET`/`POST /api/jobs/notifications` mirrors the accrual job: public in `proxy.ts`, authenticated
with `Authorization: Bearer $CRON_SECRET` (constant-time compare), and registered in `vercel.json`.
Vercel Cron issues GET, so both verbs share one handler.

`runNotificationOutbox(transport?)`:

1. A materialized CTE selects the oldest due rows (`limit 25`, `for update skip locked`) and pushes
   `next_attempt_at` ten minutes out, so two overlapping runs cannot deliver the same message. The
   CTE must stay `materialized`: an `IN (subquery … limit)` with `for update` is re-evaluated per
   outer row and defeats the batch cap.
2. Each row is sent individually; one bad address fails only its row.
3. `recordEmailResult` writes the outcome:
   - success → `sent`, `sent_at = now()`, attempts incremented, lease cleared;
   - failure → `failed` with exponential backoff (`2^attempts` minutes, capped at 60) until
     `MAX_EMAIL_ATTEMPTS = 5`, then terminal `failed` with no next attempt;
   - `EmailNotConfiguredError` → terminal `skipped`. A missing provider credential is not fixed by
     retrying.

The worker runs outside any transaction and records each attempt on its own, so a provider timeout
cannot hold a database lock.

### 6. Email transport is an adapter with a safe default

`EMAIL_TRANSPORT` is `log` (default) or `resend`. The `log` transport reports success and writes one
redacted line — local and demo environments need no provider and no secret. The `resend` transport
is a dependency-free `fetch` to `api.resend.com` behind `EMAIL_API_KEY` + `EMAIL_FROM`; both stay
server-only. When they are missing, the worker records `skipped` rather than failing the outbox.

### 7. In-app inbox is recipient-scoped at the SQL boundary

- `GET /api/notifications?limit=` lists the session user's `in_app` rows, newest first, with an
  unread count. The recipient is the session id; there is no `userId` parameter.
- `POST /api/notifications/:id/read` and `POST /api/notifications/read-all` mark rows read. Ownership
  is part of the `where` predicate, so a foreign id updates nothing and the route answers 404
  without revealing whether the row exists.
- `/notifications` renders the list; `components/domain/notification-list.tsx` handles the read
  actions and calls `router.refresh()`.
- The shell shows an unread badge in the sidebar and mobile header. `app/(app)/layout.tsx` counts
  unread rows and treats a database failure as zero — the badge is decoration and must not take
  down every protected page.

### 8. Authorization and database policy

The list/read routes resolve the actor from `getSession()` and pass the session id to the SQL
layer. There is no new role gate: every authenticated role can read their own inbox. The cron route
is the only path without a session.

The migration ships the `notifications` grants (`SELECT/INSERT/UPDATE`, no `DELETE`), the
`leavetrack_app` allow policy, the restrictive `anon`/`authenticated` deny policy, a
`set_updated_at` trigger, and `prevent_hard_delete()` in the same file (ADR-LeaveTrack-E005). The
partial index `(next_attempt_at, created_at) where channel = 'email' and status in ('pending',
'failed')` keeps the worker scan small.

## Consequences

- A submission or decision is durable even if email delivery never succeeds; the in-app row is the
  source of truth, and the email row's status records every attempt.
- Retries are bounded and observable: `attempts`, `next_attempt_at`, and `last_error` are queryable,
  and the job logs a summary per run.
- Notifications are audit-adjacent and cannot be hard-deleted, so integration tests assert per
  request and per recipient instead of global counts (the suite must stay rerunnable on one
  database).
- A managerless submission reaches every active HR admin. Resolving recipients in SQL keeps the
  fallback consistent with the people-admin lifecycle (deactivated HR admins are not notified).
- The default `log` transport means the outbox drains with an empty environment; switching to
  `resend` is a configuration change, not a code change.
- The `*/15 * * * *` schedule needs Vercel Pro; Hobby only supports daily crons. On Hobby the route
  can be triggered by an external scheduler or a manual POST with the cron secret.
- Email templates are plain text with no HTML or unsubscribe handling; that is deliberate until a
  provider and a preferences model exist.

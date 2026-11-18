-- E2-10 / US-01 AC1, US-03: notification outbox.
--
-- One durable table backs both channels:
--   * `in_app` rows are written with status 'sent' at enqueue time and read by
--     the recipient's notification list.
--   * `email` rows are written as 'pending' inside the submit/decision
--     transaction and delivered later by GET|POST /api/jobs/notifications.
--
-- The unique key is the idempotency contract (same idea as accrual_ledger): a
-- replayed submit, a retried cron, or a concurrent duplicate decision can never
-- create a second notification for the same event, request, recipient, and
-- channel.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references users (id) on delete restrict,
  actor_id uuid references users (id) on delete restrict,
  leave_request_id uuid not null references leave_requests (id) on delete restrict,
  event_type text not null check (
    event_type in ('request_submitted', 'request_approved', 'request_rejected')
  ),
  channel text not null check (channel in ('in_app', 'email')),
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'failed', 'skipped')
  ),
  subject text not null check (length(trim(subject)) between 1 and 200),
  body text not null check (length(trim(body)) between 1 and 4000),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency: one row per event, request, recipient, and channel.
  unique (event_type, leave_request_id, recipient_id, channel),
  -- Only the in-app channel can be read; email rows never carry read state.
  check (channel = 'in_app' or read_at is null)
);

create index notifications_recipient_created_idx
  on notifications (recipient_id, created_at desc);

create index notifications_request_idx
  on notifications (leave_request_id);

-- The retry worker scans exactly this slice; keep it small and partial.
create index notifications_email_queue_idx
  on notifications (next_attempt_at, created_at)
  where channel = 'email' and status in ('pending', 'failed');

create trigger notifications_set_updated_at
  before update on notifications
  for each row execute function set_updated_at();

-- Notifications are an audit-adjacent record: they are never deleted.
create trigger notifications_no_hard_delete
  before delete on notifications
  for each row execute function prevent_hard_delete();

-- ---------------------------------------------------------------------------
-- Least-privilege grants and deny-by-default RLS (ADR-LeaveTrack-E005).
-- SELECT/INSERT/UPDATE only: mark-read and retry outcomes need UPDATE, nothing
-- in the app ever deletes a notification.
-- ---------------------------------------------------------------------------

grant select, insert, update on table notifications to leavetrack_app;

revoke all on table notifications from anon, authenticated;

alter table notifications enable row level security;

create policy notifications_app_access
  on notifications for all to leavetrack_app
  using (true) with check (true);

create policy notifications_deny_clients
  on notifications as restrictive for all to anon, authenticated
  using (false) with check (false);

notify pgrst, 'reload schema';

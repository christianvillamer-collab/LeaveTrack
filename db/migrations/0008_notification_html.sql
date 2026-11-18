-- E2-10 / email design: store the designed HTML alongside the plain-text body.
--
-- The outbox already persists subject and body at enqueue time so delivery can
-- happen later, outside the request/decision transaction. The HTML rendering
-- uses the same inputs and copy builder, so it belongs on the same row. The
-- column is nullable: rows enqueued before this migration still drain with the
-- plain-text fallback, and a message never has to be re-derived at send time.

alter table notifications
  add column html_body text;

alter table notifications
  add constraint notifications_html_body_check
  -- A boundary-valid 2,000-character note can expand roughly 6x when escaped
  -- and appears in both the message copy and the detail table, so leave ample
  -- room above the ~50k worst case rather than failing a committed decision.
  check (html_body is null or length(html_body) between 1 and 100000);

comment on column notifications.html_body is
  'Designed HTML email body; null for rows enqueued before the design or for in-app rows.';

notify pgrst, 'reload schema';

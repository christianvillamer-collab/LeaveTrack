-- Idempotent demo seed. Safe to run repeatedly: every insert has a fixed id
-- and ON CONFLICT DO NOTHING, so counts never change.

insert into leave_types (id, name, tracks_balance) values
  ('11111111-1111-4111-8111-111111111111', 'Vacation', true),
  ('22222222-2222-4222-8222-222222222222', 'Sick', true),
  ('33333333-3333-4333-8333-333333333333', 'Unpaid', false)
on conflict (id) do nothing;

insert into users (id, name, email, role, manager_id) values
  ('a0000000-0000-4000-8000-000000000001', 'Daniel Okafor', 'daniel.okafor@leavetrack.demo', 'manager', null),
  ('a0000000-0000-4000-8000-000000000002', 'Erin Walsh', 'erin.walsh@leavetrack.demo', 'manager', null),
  ('a0000000-0000-4000-8000-000000000003', 'Priya Nair', 'priya.nair@leavetrack.demo', 'hr_admin', null),
  ('a0000000-0000-4000-8000-000000000004', 'Maya Chen', 'maya.chen@leavetrack.demo', 'employee', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000005', 'Luis Ortega', 'luis.ortega@leavetrack.demo', 'employee', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000006', 'Amara Diallo', 'amara.diallo@leavetrack.demo', 'employee', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000007', 'Tom Becker', 'tom.becker@leavetrack.demo', 'employee', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000008', 'Sana Iqbal', 'sana.iqbal@leavetrack.demo', 'employee', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000009', 'Kai Nakamura', 'kai.nakamura@leavetrack.demo', 'employee', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000010', 'Nina Petrov', 'nina.petrov@leavetrack.demo', 'employee', 'a0000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- Vacation and Sick accrue; Unpaid deliberately has no policy row (BR-07).
insert into leave_policies (user_id, leave_type_id, accrual_per_month)
select u.id, t.id,
  case t.name when 'Vacation' then 1.25 else 1.00 end
from users u
cross join leave_types t
where t.tracks_balance = true
on conflict (user_id, leave_type_id) do nothing;

insert into leave_balances (user_id, leave_type_id, balance)
select u.id, t.id,
  case
    when t.name = 'Vacation' then 12.50
    else 8.00
  end
from users u
cross join leave_types t
where t.tracks_balance = true
on conflict (user_id, leave_type_id) do nothing;

insert into leave_requests
  (id, user_id, leave_type_id, start_date, end_date, reason, status, decided_by, decided_at, decision_note, created_at)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '2026-11-16', '2026-11-20', 'Family trip booked earlier this year. Handover notes are in the design sprint board.', 'pending', null, null, null, '2026-11-01T09:12:00Z'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', '2026-10-06', '2026-10-07', 'Flu — doctor advised two days of rest.', 'approved', 'a0000000-0000-4000-8000-000000000001', '2026-10-05T16:40:00Z', 'Get well soon.', '2026-10-04T08:05:00Z'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '2026-08-10', '2026-08-14', 'Summer break with family.', 'approved', 'a0000000-0000-4000-8000-000000000001', '2026-07-21T10:02:00Z', null, '2026-07-18T13:30:00Z'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '2026-11-23', '2026-11-27', 'Thanksgiving week with my parents out of state.', 'pending', null, null, null, '2026-11-02T07:45:00Z'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000006', '22222222-2222-4222-8222-222222222222', '2026-11-09', '2026-11-09', 'Dental procedure in the morning.', 'pending', null, null, null, '2026-11-02T14:18:00Z'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333', '2026-11-30', '2026-12-02', 'Moving apartments — no paid leave left for the year.', 'pending', null, null, null, '2026-11-03T08:01:00Z'),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', '2026-10-19', '2026-10-21', 'Long weekend away.', 'rejected', 'a0000000-0000-4000-8000-000000000001', '2026-10-12T11:25:00Z', 'Overlaps the pricing launch. Please pick dates after 26 Oct.', '2026-10-09T15:40:00Z'),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '2026-11-18', '2026-11-20', 'Wedding in Osaka.', 'pending', null, null, null, '2026-11-01T11:10:00Z'),
  ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000010', '22222222-2222-4222-8222-222222222222', '2026-10-28', '2026-10-29', 'Migraine, working from home is not possible.', 'approved', 'a0000000-0000-4000-8000-000000000002', '2026-10-27T09:55:00Z', null, '2026-10-27T07:20:00Z'),
  ('b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '2026-12-21', '2026-12-23', 'Year-end break.', 'approved', 'a0000000-0000-4000-8000-000000000003', '2026-10-30T09:00:00Z', 'Auto-approved — HR admin.', '2026-10-29T12:00:00Z'),
  ('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '2026-12-07', '2026-12-09', 'Planning retreat followed by two days of family time.', 'pending', null, null, null, '2026-11-02T10:30:00Z')
on conflict (id) do nothing;

insert into audit_log (id, leave_request_id, actor_id, action, detail, occurred_at) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'submitted', 'Vacation request submitted for 16–20 Nov 2026.', '2026-11-01T09:12:00Z'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', 'submitted', 'Sick leave request submitted for 6–7 Oct 2026.', '2026-10-04T08:05:00Z'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'approved', 'Approved by Daniel Okafor. Sick balance reduced by 2 days.', '2026-10-05T16:40:00Z'),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'rejected', 'Rejected: overlaps the pricing launch. No balance change.', '2026-10-12T11:25:00Z'),
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000002', 'approved', 'Approved by Erin Walsh. Sick balance reduced by 2 days.', '2026-10-27T09:55:00Z'),
  ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005', 'submitted', 'Vacation request submitted for 23–27 Nov 2026.', '2026-11-02T07:45:00Z'),
  ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000006', 'submitted', 'Sick leave request submitted for 9 Nov 2026.', '2026-11-02T14:18:00Z'),
  ('c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000003', 'approved', 'Auto-approved for HR admin. Vacation balance reduced by 3 days.', '2026-10-30T09:00:00Z')
on conflict (id) do nothing;

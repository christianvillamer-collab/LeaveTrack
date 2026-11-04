-- LeaveTrack initial schema
-- Source: docs/arch-docs/ARCH-LeaveTrack-v1.0.md (Data Model)
-- Traces: BR-02, BR-04, BR-06, BR-07; US-01..US-08.

create extension if not exists pgcrypto;

create type user_role as enum ('employee', 'manager', 'hr_admin');
create type request_status as enum ('pending', 'approved', 'rejected');

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null,
  role user_role not null default 'employee',
  manager_id uuid references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_format check (position('@' in email) > 1),
  constraint users_not_own_manager check (manager_id is null or manager_id <> id)
);

create unique index users_email_lower_unique on users (lower(email));
create index users_manager_id_idx on users (manager_id);

create table leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 60),
  tracks_balance boolean not null default true,
  created_at timestamptz not null default now()
);

create table leave_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  leave_type_id uuid not null references leave_types (id) on delete restrict,
  accrual_per_month numeric(6, 2) not null default 0 check (accrual_per_month >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, leave_type_id)
);

create table leave_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  leave_type_id uuid not null references leave_types (id) on delete restrict,
  balance numeric(7, 2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, leave_type_id)
);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  leave_type_id uuid not null references leave_types (id) on delete restrict,
  start_date date not null,
  end_date date not null,
  reason text not null check (length(trim(reason)) between 5 and 2000),
  status request_status not null default 'pending',
  decided_by uuid references users (id) on delete restrict,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_date_order check (end_date >= start_date),
  constraint leave_requests_decision_shape check (
    (status = 'pending' and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

create index leave_requests_user_created_idx
  on leave_requests (user_id, created_at desc);

create index leave_requests_active_user_idx
  on leave_requests (user_id)
  where is_deleted = false;

create index leave_requests_status_created_idx
  on leave_requests (status, created_at desc)
  where is_deleted = false;

create index leave_requests_manager_scope_idx
  on leave_requests (user_id, status, created_at desc)
  where is_deleted = false;

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references leave_requests (id) on delete restrict,
  actor_id uuid not null references users (id) on delete restrict,
  action text not null check (action in ('submitted', 'approved', 'rejected')),
  detail text,
  occurred_at timestamptz not null default now()
);

create index audit_log_request_idx on audit_log (leave_request_id, occurred_at desc);
create index audit_log_actor_idx on audit_log (actor_id, occurred_at desc);

-- Keep updated_at honest without application code.
create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

create trigger leave_policies_set_updated_at
  before update on leave_policies
  for each row execute function set_updated_at();

create trigger leave_balances_set_updated_at
  before update on leave_balances
  for each row execute function set_updated_at();

create trigger leave_requests_set_updated_at
  before update on leave_requests
  for each row execute function set_updated_at();

-- BR-04: no hard-delete path for requests or audit records. Soft delete only.
create function prevent_hard_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is not permitted on %; use is_deleted instead', TG_TABLE_NAME;
end;
$$;

create trigger leave_requests_no_hard_delete
  before delete on leave_requests
  for each row execute function prevent_hard_delete();

create trigger audit_log_no_hard_delete
  before delete on audit_log
  for each row execute function prevent_hard_delete();

create function prevent_audit_update() returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit records are append-only';
end;
$$;

create trigger audit_log_no_update
  before update on audit_log
  for each row execute function prevent_audit_update();

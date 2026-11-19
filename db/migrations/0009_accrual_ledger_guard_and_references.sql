-- E2-17: the accrual ledger is a permanent compliance artifact, so a purge
-- followed by a rerun must not be able to double-accrue. Leave requests also
-- need a real, stable, unique reference instead of a value derived from the UUID.

create function prevent_accrual_ledger_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'accrual_ledger is append-only';
end;
$$;

revoke execute on function public.prevent_accrual_ledger_mutation()
  from public, anon, authenticated;

create trigger accrual_ledger_no_delete_or_update
  before delete or update on accrual_ledger
  for each row execute function prevent_accrual_ledger_mutation();

-- Reuse every already-issued LR- display value, then give new rows generated
-- values from a sequence seeded above the largest backfilled suffix. The only
-- exceptions are legacy suffix collisions, which are moved onto fresh sequence
-- values so the new unique constraint cannot abort the migration.
alter table leave_requests add column reference text;

update leave_requests
set reference = 'LR-' || upper(right(replace(id::text, '-', ''), 8))
where reference is null;

create sequence leave_request_reference_seq as bigint;

select setval(
  'leave_request_reference_seq',
  coalesce(max(('x' || substring(reference from 4))::bit(32)::bigint), 0) + 1,
  false
)
from leave_requests;

-- The legacy display value used only the last 32 bits of the UUID, so a large
-- database can contain two rows with the same suffix. Keep the first row's
-- historical value and move only later duplicates onto fresh sequence values,
-- which start above every backfilled suffix and therefore cannot collide.
with ranked as (
  select
    id,
    row_number() over (partition by reference order by id) as duplicate_rank
  from leave_requests
)
update leave_requests lr
set reference = 'LR-' || upper(lpad(to_hex(nextval('leave_request_reference_seq')), 8, '0'))
from ranked
where lr.id = ranked.id
  and ranked.duplicate_rank > 1;

alter table leave_requests
  alter column reference set default (
    'LR-' || upper(lpad(to_hex(nextval('leave_request_reference_seq')), 8, '0'))
  ),
  alter column reference set not null,
  add constraint leave_requests_reference_unique unique (reference);

revoke all on sequence leave_request_reference_seq from public, anon, authenticated;
grant usage on sequence leave_request_reference_seq to leavetrack_app;

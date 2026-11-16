# ADR-LeaveTrack-E006 — Policy Effective Dating

**Status:** Accepted — implemented by E2-08. Supersedes nothing; extends the policy read/write model described in `ARCH-LeaveTrack-v1.0`.

## Context

`leave_policies` originally held one mutable rate per `(user_id, leave_type_id)`:

```sql
create table leave_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  leave_type_id uuid not null references leave_types (id) on delete restrict,
  accrual_per_month numeric(6, 2) not null check (accrual_per_month >= 0),
  unique (user_id, leave_type_id)
);
```

The monthly accrual job read `accrual_per_month` directly, and the dashboard and balance card
did the same. That is enough while rates never change, but E2-08 requires a mid-year change to
affect **only future accrual periods**, and requires exactly one audit row per change. With a
single mutable row:

- A rate change erases the rate that past months were accrued at, so a late or backfilled run
  credits the new rate for an old month.
- History exists only in whichever copy of the value happened to be captured elsewhere; the
  database cannot answer "what was the rate in March?".
- `audit_log` cannot record the change: it is request-bound (`leave_request_id NOT NULL`) and
  its `action` CHECK is `('submitted','approved','rejected')`.

The product rule is "changes start with a chosen month; past periods and balances are never
recalculated". The schema must make that rule true, not merely ask the UI to respect it.

## Decision drivers

1. A mid-year change affects only periods at or after its effective month.
2. Past months remain reconstructible; no past accrual is rewritten.
3. One audit row per real change, append-only.
4. The accrual job resolves the rate for its **run period**, while reads resolve the rate for
   **today**.
5. Additive migration; no hard deletes; no new credential path.
6. Same posture for the new table: RLS, restrictive client deny, least-privilege grants.

## Options

### 1. One mutable row, plus a `updated_at` history table

- **Pros:** no change to the read queries; history is "just another table".
- **Cons:** reads still need a "which rate applied then" table to be correct, so there are two
  sources of truth that can disagree. A correction changes the mutable row whether or not it is
  a new period.
- **Verdict:** rejected — the history table silently becomes load-bearing.

### 2. Version rows with `valid_from` / `valid_to` ranges

- **Pros:** explicit interval semantics.
- **Cons:** every write must also close the previous interval, so two rows change per save and
  the "one audit row per change" rule needs an extra safeguard. Overlapping/gapped intervals
  are easy to create.
- **Verdict:** rejected — half-open interval bookkeeping for no product benefit.

### 3. One row per `(user, leave type, effective month)`, resolved by date

- **Pros:** each rate is immutable once its month is past; a change is a new dated row; a
  correction is an upsert of one dated row; a single `distinct on … order by effective_from
desc` resolves every reader. Uniqueness makes duplicate periods impossible.
- **Cons:** readers must all carry the effective-date predicate; a future-dated row is invisible
  to a current-date read, which is the intended behaviour but must be tested.
- **Verdict:** **chosen**.

### 4. Store the resolved rate on `accrual_ledger` only

- **Pros:** past runs are fully self-describing.
- **Cons:** says nothing about future months, so the job still needs a source for the rate it
  will apply; and the ledger is the idempotency marker, not a policy store.
- **Verdict:** rejected as the primary model. (The ledger already keeps `days`, which is enough
  to audit a past run.)

## Decision

### Schema

`db/migrations/0004_policy_effective_dating.sql`:

- Adds `leave_policies.effective_from date`, backfills existing rows to `date '2000-01-01'`
  (they predate effective dating and apply to every period), sets `NOT NULL`, and adds
  `check (extract(day from effective_from) = 1)`.
- Replaces `unique (user_id, leave_type_id)` with
  `unique (user_id, leave_type_id, effective_from)`.
- Grants `INSERT, UPDATE` on `leave_policies` to `leavetrack_app`; `DELETE` remains ungranted,
  so history cannot be removed through the app role.
- Creates `policy_audit_log` (employee, leave type, effective month, previous rate, new rate,
  actor, timestamp) with RLS, the `leavetrack_app` allow policy, the `AS RESTRICTIVE` client
  deny policy, `SELECT/INSERT` grants only, and the existing `prevent_hard_delete` /
  `prevent_audit_update` triggers. This is the same posture every new table must ship
  (ADR-LeaveTrack-E005).

A dedicated policy log is used instead of `audit_log` because that table requires a request and
its action CHECK is request-only. Nothing about the request audit trail changes.

### Reads

The rate in effect for an as-of date is the latest row with `effective_from <= as-of`:

```sql
select distinct on (p.user_id, p.leave_type_id)
  p.user_id, p.leave_type_id, p.accrual_per_month
from leave_policies p
where p.effective_from <= $1::date
order by p.user_id, p.leave_type_id, p.effective_from desc
```

- `runAccrual(period)` uses the **run period**.
- `getBalancesForUser` and `listPolicyOverview` use the **current UTC date**.
- Future-dated rows are excluded from today's reads, so a scheduled raise is not shown early.
- `effective_from` is a month start in UTC, matching `accrual_ledger.period`.

### Writes

`upsertPolicyRate` (`lib/db/policies.ts`) backs `POST /api/policies`:

- HR only (`canConfigurePolicies`); employees and managers receive 403, no session 401.
- `effectiveFrom` must be a month start (`policyRateInputSchema`).
- A month before the current UTC month is rejected with 400; the current and future months are
  accepted until that month has accrued. Once `accrual_ledger` holds `(user, leave type, period)`,
  a save for that month is rejected with 409, because the idempotent run can never apply it.
  "Update" is a correction of the current or a future month, never a past one.
- One transaction: read the same-month row and the prior effective row, return early when the
  same-month rate is unchanged (`auditWritten: false`), otherwise upsert one dated row and
  insert exactly one `policy_audit_log` row with `previous_rate` and the session actor.
- Unknown employee 404; untracked leave type 400.

The client-supplied actor is rejected by the strict schema; the session is the only identity
source.

### UI

`/settings/policies` is read/write for HR: a form (employee, tracked leave type, rate, effective
month), the current-rate snapshot grouped by leave type, the recent change log, accrual status,
and the guardrails. The page and the route both call `canConfigurePolicies`.

## Consequences

- A mid-year change is a new row; months before it keep their old rate and their already-accrued
  balances. A late run for an old month uses that month's rate.
- Three predicates must stay aligned: run period for accrual, current UTC date for reads. They
  share the same shape, not the same as-of value.
- `previous_rate` on a change is the rate in effect immediately before the new month, so the
  change log reads as a rate history rather than a series of independent edits.
- `policy_audit_log` is append-only and cannot be updated or hard-deleted; a same-rate save
  writes nothing.
- A month locks once it has accrued: `accrual_ledger` is the idempotency marker, so a rate saved
  for an already-applied period would be recorded but never used. The write rejects it with 409
  instead of confirming a change the next run ignores.
- Adding a column and replacing a unique constraint is additive but not online-safe on a large
  table; at the current 800-person scale the rewrite is trivial. Revisit with a concurrent index
  build if `leave_policies` ever grows by orders of magnitude.
- Pattern: `knowledge/patterns/effective-dated-policy.md`.

## Alternatives considered and rejected

- **Overwrite in place and log the old value** — the log would be the only source of truth for
  past rates; any reader without the log is wrong.
- **Do not backfill `effective_from`** — a nullable as-of column forces every predicate into an
  `IS NULL` branch and makes "no rate" indistinguishable from "rate since forever". The
  `2000-01-01` sentinel is explicit and tested.
- **Extend `audit_log`** — would require a nullable `leave_request_id` and a wider action CHECK,
  weakening the request trail for a policy feature.

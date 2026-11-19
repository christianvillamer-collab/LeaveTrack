# ADR-LeaveTrack-E002 — Accrual Idempotency

**Status:** Accepted (retroactive; documents TASK-017 / US-07)

## Context

US-07 requires a monthly accrual run that increases every tracked balance by the employee's policy rate and never double-accrues if the job runs twice in the same month. The job is triggered by a scheduler (Vercel Cron), so retries, manual reruns, and a first run on a later day of the month are all expected.

`leave_balances.updated_at` cannot be the month marker. Approval, rejection restoration, and any manual adjustment also move it, so "updated this month" would skip users whose balance changed for an unrelated reason.

## Options considered

1. **Inspect `leave_balances.updated_at`.** Rejected: unrelated balance writes move the timestamp, so the job cannot distinguish an accrual from an approval.
2. **A single `job_runs` row per period.** Rejected: it records that the job ran, not which `(user, leave type)` pairs were credited. A user added mid-month, a partial failure, or a new policy would be ambiguous.
3. **An `accrual_ledger` keyed by `(user_id, leave_type_id, period)`.** Chosen: the ledger is the authoritative record of exactly which pairs have been credited for which month.

## Decision

- `accrual_ledger` stores one row per `(user_id, leave_type_id, period)`, with a unique constraint on that tuple.
- `period` is the UTC month start (`YYYY-MM-01`); the DB check `extract(day from period) = 1` enforces it.
- The ledger insert and the balance credit run in **one SQL statement**: a CTE inserts eligible pairs with `on conflict do nothing` and only the newly inserted rows feed the balance upsert. The ledger can never claim an accrual that was not credited, or vice versa.
- Eligible pairs are `leave_policies` joined to `leave_types` where `tracks_balance = true` and `accrual_per_month > 0`. Unpaid and zero-rate policies are skipped.
- The route is `GET`/`POST /api/jobs/accrual`, is public at `proxy.ts`, and authorizes itself with `Authorization: Bearer $CRON_SECRET` (timing-safe compare). A missing secret returns 503; a bad header returns 401.
- Vercel Cron issues `GET`; both verbs share the handler. A daily schedule is safe because repeat runs are no-ops.

## Consequences

- **Positive:** idempotency is a database invariant, not application logic. Concurrent or repeated runs cannot double-credit. A user or policy added mid-month accrues on the next run because its pair has no ledger row yet.
- **Positive:** `lastAccruedAt` is derived from `accrual_ledger.created_at`, so approval and restore writes no longer pollute the "last accrual" timestamp.
- **Positive (E2-17):** a `BEFORE DELETE OR UPDATE` trigger makes the ledger append-only, so a manual purge followed by a rerun can no longer double-accrue. The trigger function's `EXECUTE` is revoked from `PUBLIC`/`anon`/`authenticated`; only DDL owners can disable it deliberately.
- **Negative:** the ledger is a permanent compliance artifact. Correcting a bad run requires an explicit compensating entry with its own audit trail, never a DELETE/UPDATE or an unannounced migration.
- **Operational:** Vercel Hobby only permits daily cron schedules. The monthly expression `0 6 1 * *` needs Pro; daily runs are safe because the ledger makes them no-ops.

# Pattern: HTTP load testing at 800 users (E2-14)

Use this when adding a realistic concurrency test to a Next.js + Postgres app
that has a separate database-only benchmark.

## Separate the two benchmarks

A DB-only harness (`scripts/bench-list-endpoints.mjs`) and an HTTP harness
(`scripts/load-test-800.mjs`) answer different questions and must not share a
result file or a database:

- DB-only proves the SQL and indexes are fast in isolation.
- HTTP proves auth, middleware, SSR, and the full request path survive 800
  concurrent signed-in users and that writes stay transactional under load.

Never cite the DB-only numbers as the HTTP baseline.

## Fail closed on every input

Before opening a socket, the harness must reject:

- any base URL that is not `http://` on `localhost`/`127.0.0.1`;
- any `DATABASE_URL`/`DIRECT_URL` other than one hard-coded disposable local
  database name, checked for **both** variables;
- missing Supabase URL/anon/service-role key or seed password.

Also assert `current_database()` inside the seed transaction. A connection
string check alone cannot catch a proxy or pooler that redirects to another
database.

## Batch bulk inserts below the bind-parameter limit

postgres.js binds one parameter per value. A single `insert into leave_requests
${sql(20_000Rows)}` blows past PostgreSQL's 65,534-parameter ceiling
(`MAX_PARAMETERS_EXCEEDED`). Chunk every bulk insert to ~1,000 rows (10–20k
parameters) and keep the chunks inside the same transaction. This matters most
for the request set (20,000 rows) and its audit rows (~33,000); the 800-row
people seed is already under the limit. Batching is invisible to the dataset —
`on conflict ... do nothing` keeps reruns idempotent.

## Provision identities deterministically

Use fixed UUIDs and `example.test` emails with `on conflict (lower(email))`, so
reruns are idempotent. Create Supabase Auth users with the service role key and
`email_confirm: true`, then write each auth `user.id` into `users.auth_subject`
in the same DB transaction. `resolveUserForIdentity` matches the subject first
and only falls back to email when `auth_subject is null`, so linking is what
makes the seeded sessions resolve under load.

## Budget real sessions against the Auth rate limit

Supabase Auth caps session creation at roughly 40 requests per window **per IP**,
on both `signInWithPassword` and admin magic-link `verifyOtp`, and using the
service-role key as `apikey` does not grant a separate bucket. Minting 800
distinct sessions in one run is therefore impossible on a hosted project.

For an HTTP load test, mint a small pool of real sessions (default 32 here:
8 managers + 1 HR + 23 employees) and round-robin them across the 800 virtual
users by role. Concurrency, endpoints, and authentication stay real; only
identity-per-VU is shared. Record the pool size in the report so the baseline is
not mistaken for a 800-distinct-identity run. Add bounded retry/backoff on 429s
and keep every manager and HR virtual user on its own session so role-scoped
queries still exercise distinct principals.

If a task truly requires 800 distinct identities, raise the project's Auth rate
limit or spread sign-ins across windows — do not silently share sessions and
claim otherwise.

## Reproduce the SSR session cookie exactly

`@supabase/ssr` stores a session as:

```
sb-<project-ref>-auth-token = base64-<base64url(JSON.stringify(session))>
```

`<project-ref>` is `new URL(supabaseUrl).hostname.split(".")[0]`. Build this
from a `signInWithPassword` session and send it as the `cookie` header. Keep the
encoded value under the 3180-character SSR chunk limit by keeping user metadata
small. `getUser()` on the server then verifies the token against Supabase Auth
for every request — expect that network verification to dominate latency, which
is exactly what the HTTP test must surface.

## Ramp, think time, and a mixed workload

- Ramp virtual users in over ~10s instead of releasing 800 at once, so a cold
  start is not mistaken for a steady-state regression.
- Give each user a short think time (~500ms) between requests.
- Mix reads (`/balance`, list endpoints) with a periodic write (`POST` submit)
  so notification outbox rows and audit rows are created under concurrency.
- Scope each role to endpoints it is allowed to call (manager→team, HR→audit),
  otherwise authorization 403s pollute the error count.

## Gate on both latency and errors

Record p50/p95/p99/max per endpoint and a success/failure count per endpoint.
Pass only when every measured endpoint's p95 is below the target **and** the
total failure count is zero. Write a JSON report and exit non-zero on failure;
CI can then upload the report as an artifact with `if: always()`.
**Never tune the timeout or threshold to turn a failing run green.** Commit the
honest failing baseline and leave the task open.

## Isolate a failing p95 before attributing blame

When p95 pins to the request timeout, probe the same server at fixed concurrency
(50, 200) across a control endpoint with no auth, an API endpoint with auth +
DB, and a full SSR page. In E2-14, `/api/health` stayed at 102ms/286ms while
`/api/leave-requests` was 601ms/1204ms and `/balance` 1452ms/4722ms, isolating
the cost to per-request auth verification and SSR rather than Postgres (already
proven at 1–7ms by the DB-only baseline). Record the probe in the run book so a
capacity failure is actionable instead of a mystery number.

## Schedule safely

Run in a weekly `schedule` plus `workflow_dispatch`, never on push/PR. Gate on
a repository variable plus secrets, use a disposable Postgres service on the
exact port the harness requires, and never print secret values. The service
role key belongs only to the seeding step, never to the measured app config.

## Related

- `docs/performance/e2-14-load-test.md` — run book and baseline location.
- `knowledge/patterns/manager-scope.md` — the SQL predicate the team reads use.
- `knowledge/retros/e2-14.md` — implementation notes.

# E2-14 HTTP load test (800 concurrent users)

Status: **harness committed; live baseline pending an authorized run.**

This is the HTTP-level companion to the database-only E2-13 baseline in
`docs/performance/e2-13-baseline.md`. E2-13 measured SQL page helpers with one
connection and no browser, auth, or HTTP layer. E2-14 drives the real Next.js
server with 800 signed-in virtual users over HTTP and covers both reads and
writes.

## What is measured

`scripts/load-test-800.mjs` sends authenticated requests from 800 virtual users:

| Role     | Users | Traffic                                                   |
| -------- | ----: | --------------------------------------------------------- |
| HR admin |     1 | `/balance`, `GET /api/audit/:userId`                      |
| Manager  |     8 | `GET /api/leave-requests?scope=team`, `scope=mine`        |
| Employee |   791 | `GET /balance`, `GET /requests`, `scope=mine`, `POST` mix |

Every 10th employee iteration is a `POST /api/leave-requests`, so the run
exercises the transactional submit path (request + audit + notification outbox)
as well as the read endpoints. Each virtual user ramps in over 10 seconds and
thinks for 500ms between requests; the measured window is 60 seconds by default.

**Session pooling.** Supabase Auth rate-limits session creation to ~40 per window
per IP, so the 800 VUs cannot each get a distinct session in one run. The harness
instead mints a pool of 32 real sessions (8 managers, 1 HR, 23 employees) and
round-robins them across VUs by role; each manager and HR VU keeps its own
session, so role-scoped queries still exercise distinct principals. Concurrency,
authentication, and endpoints are unchanged, but identities are shared — the
report records `authPoolSize` so the baseline is not misread as 800 distinct
identities. Override with `LOAD_TEST_AUTH_POOL` only if the Auth limit allows it.

The endpoints named by the acceptance criterion are `GET /balance` and the list
reads (`GET /api/leave-requests`, `GET /requests`). Their p95 must stay below
500ms, and **every** request in the run must return a 2xx. Any 4xx/5xx or
transport error fails the run.

## Safety guards (fail closed)

The harness exits before opening a connection unless all of the following hold:

- `LOAD_TEST_BASE_URL` is an absolute **http** URL whose host is `localhost` or
  `127.0.0.1`. No remote or https target is accepted.
- `DATABASE_URL` **and** `DIRECT_URL` are both exactly
  `postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e214_load`.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, and `SEED_AUTH_PASSWORD` (at least 8 characters)
  are all set. The service role key is used **only** to provision seeded auth
  identities, never by the measured app traffic.

At seed time it also asserts `current_database()` is `leavetrack_e214_load`, so
a pooled connection string that silently resolves elsewhere cannot load data
into a real project. No secret value is ever written to a log or to the report;
only status codes, timings, and counts are recorded.

## Dataset

| Property        | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Database        | `leavetrack_e214_load` (local Docker/Postgres service)  |
| Managers / HR   | 8 / 1                                                   |
| Employees       | 800 (791 become virtual users)                          |
| Requests seeded | 20,000 (25 per employee)                                |
| Virtual users   | 800                                                     |
| Auth identities | 809 confirmed Supabase users, subject-linked in `users` |
| Session pool    | 32 real sessions, role-routed across 800 VUs            |

Seed rows are deterministic UUIDs and idempotent, so repeated runs reuse the
same identities. The load database is disposable and is never a Supabase-hosted
project.

## Reproduce locally

```bash
npm run db:up
export DATABASE_URL='postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e214_load'
export DIRECT_URL='postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e214_load'
# also set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY and SEED_AUTH_PASSWORD
npm run db:migrate
npm run db:seed
npm run build
npm run start &            # serve the app on http://localhost:3000
npm run load:800
```

`npm run load:800:seed` seeds the database and auth identities without running
the load, which is useful for preparation. The measured run writes
`docs/performance/e2-14-results.json` and prints the same JSON to stdout; a
non-zero exit means a p95 regression or any request error.

## Scheduled run

`.github/workflows/load-800.yml` runs weekly (Monday 03:00 UTC) and on demand.
It is gated by the repository variable `E2_14_LOAD_TEST_ENABLED=true` and the
four Supabase secrets above; without them the job is skipped or fails fast. The
workflow provisions a disposable Postgres service on port 55432, migrates and
seeds it, builds and starts the app, runs the harness, and uploads the report as
an artifact. It never runs on push or pull request.

## Baseline — recorded, FAILED

Generated 2026-11-18T03:16:51Z against the local disposable database and a
single `next start` process on port 3100, with 800 virtual users and a 32-session
auth pool. Full output: `docs/performance/e2-14-results.json`.

| Endpoint       |     p50 |        p95 | Success | Failure |
| -------------- | ------: | ---------: | ------: | ------: |
| `myList`       | 13159ms | 15001.51ms |     787 |    1086 |
| `teamList`     |  6643ms | 15001.14ms |      37 |      21 |
| `balance`      |  3550ms | 15001.01ms |    1686 |     514 |
| `requestsPage` |  4782ms | 15001.01ms |    1600 |     541 |
| `audit`        |  6759ms | 15001.19ms |       5 |       4 |
| `submit`       |  8028ms | 15001.30ms |     602 |     392 |

**Result: FAIL.** Every p95 sits at the 15s request timeout and 2,558 requests
failed, so neither the <500ms p95 criterion nor the zero-error criterion passes.
E2-14 stays Open. This is a real capacity finding, not a harness artifact;
the run book records it as measured rather than tuning the gate to pass.

### Bottleneck isolation

A controlled probe against the same server (same session, no think time) gave:

| Endpoint                                | p95 @50 VUs | p95 @200 VUs |
| --------------------------------------- | ----------: | -----------: |
| `/api/health` (no auth)                 |       102ms |        286ms |
| `/api/leave-requests` (auth + Postgres) |       601ms |       1204ms |
| `/balance` (auth + Postgres + SSR)      |      1452ms |       4722ms |

Postgres is not the constraint — E2-13 measured the same list queries at 1–7ms.
Two layers dominate: `getSession()` calls Supabase Auth `getUser()` over the
network on every request (~500ms), and server-rendering `/balance` adds ~850ms.
A single Next.js process on one machine cannot absorb 800 concurrent users at
that per-request cost, so requests queue until the harness's 15s timeout.

Closing this gap needs app or infrastructure work outside E2-14's measurement
scope — for example local `getClaims()` verification at the proxy, render caching,
or multiple app instances behind a load balancer. Those are logged as backlog in
`knowledge/retros/e2-14.md`. Do not edit the results JSON to claim a pass.

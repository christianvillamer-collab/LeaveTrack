# API endpoint pattern (Day 1+)

`POST /api/leave-requests` is the reference implementation. Keep routes thin: authenticate,
validate, resolve the DB user, then delegate SQL to `lib/db/*`.

## Shape

```ts
// app/api/leave-requests/route.ts
import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { getSession } from "@/lib/auth/session";
import { createLeaveRequest } from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";
import { leaveRequestInputSchema } from "@/lib/validation/leave";

export const runtime = "nodejs";

export const POST = withApiHandler(
  "POST /api/leave-requests",
  async (request) => {
    const session = await getSession();
    if (!session) throw AppError.unauthenticated();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw AppError.validation("Send a valid JSON request body.");
    }

    const input = leaveRequestInputSchema.parse(body);
    const user = await findUserByEmail(session.email);
    if (!user) throw AppError.forbidden("No employee record is linked to this account.");

    // SQL + transaction + audit live in lib/db/leave.ts.
    return createLeaveRequest({ userId: user.id, ...input });
  },
  { successStatus: 201 },
);
```

## Checklist

- [ ] Zod-validate body/query before touching the DB; use `.strict()` on write bodies.
- [ ] Restrict query scopes to the task. `scope=mine` must not silently accept `team`; adding
      `team` requires the manager-scope task and a SQL `manager_id` predicate.
- [ ] `getSession()` in the route (not `requireSession`, which redirects); 401 vs 403 distinct.
- [ ] Resolve identity from the session/DB, never a client-supplied `userId`.
- [ ] Manager scope in SQL (`manager_id = :current_user_id`), never in JS after the query.
- [ ] Parameterized SQL only; delegate to `lib/db/*`, no SQL in the route.
- [ ] Business mutation + audit insert in one transaction.
- [ ] Return `{ success:true, data }` via `withApiHandler`; use `successStatus: 201` for creates.
- [ ] Tests: success, validation, unauthenticated, forbidden, scope isolation, and DB integration
      when the route writes.
- [ ] Update `docs/dev-tasks` status and add a route entry to the README/arch if new.

## Handler-level mock tests (E2-15)

`tests/route-auth-matrix.test.ts` and its companion suites test route handlers directly, so the
authorization/envelope contract is enforced in CI without a database. The non-obvious constraints:

- Keep the real `lib/auth/policy.ts` and real Zod schemas unmocked; mock only `getSession` and the
  `lib/db/*` modules. That way 401/403/404/409 come from production code, not test doubles.
- Mock `@/lib/config/env` through `vi.hoisted` with `LOG_LEVEL: "silent"` and a dummy
  `CRON_SECRET`. Pino reads the level at module load; the mock must be hoisted above the logger's
  import, otherwise output leaks. The mock bypasses env's zod enum, so these short values are fine.
- Construct DB-thrown errors in tests with `new AppError(ERROR_CODES.CONFLICT, message, 409)` (and
  the matching `NOT_FOUND` / `VALIDATION_ERROR` codes). `AppError` has no `.conflict()` helper.
  Have the mocked DB function throw the state-held error so the handler's `withApiHandler` maps it
  to the real envelope.
- Assert the full envelope, not just the status: `{ success:false, error:{ code, message } }` for
  failures and `{ success:true, data }` for successes. Remember `{ successStatus: 201 }` on creates.
- Guard against silent coverage gaps with a filesystem-driven check: walk `app/api/**/route.ts`,
  derive each path (normalize `[param]` to `:param`) and each exported `GET|POST|...` verb, and fail
  if any has no matrix case. A fixed `toHaveLength(N)` on a hand-maintained table lets new routes
  escape.
- Cron jobs are bearer-only and never call `getSession`; assert `getSession` is unused and compare
  the accrual period to `accrualPeriod()` rather than a loose regex. Proxy bypass belongs in
  `tests/proxy-auth.test.ts`, not the handler suite.

These suites run in `npm run test` (empty env, fully mocked DB) and never touch `test:db`'s database,
so there is no DB-suite concurrency. See `knowledge/retros/e2-15.md`.

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

# Implement-and-test chain

Use this chain for every Day 1 task. It mirrors `/evaluate → /plan → /apply → /validate`.

## 1. Evaluate

- Load the CSV row from `docs/dev-tasks/`, the relevant arch section, and `AGENTS.md`.
- Read the current mock selector and the component props the feature touches.
- List the files and DB objects in the blast radius. For manager/HR work, include the SQL scope
  predicate and the audit write.
- Identify risk: balance math, cross-team visibility, hard-delete paths, cookie/session changes.

## 2. Plan

- State the API contract (method, path, auth, request schema, response/error codes).
- State the DB change (new migration, index, constraint) and why.
- State the component/prop change; keep the existing prop shape where possible.
- State the tests: unit + route + scoping/negative.
- Stop for approval if the change touches auth, scoping, accrual, or the schema.

## 3. Apply

```bash
# only if dependencies change
npx vitest run tests/<new>.test.ts      # red first
npm run lint
npm run typecheck
npm run test
npm run build
```

Implementation checklist:

- [ ] Zod schema at the boundary, server-side date-range validation.
- [ ] Auth via `requireSession`/`requireRole`; record-level check where applicable.
- [ ] Manager filter in SQL, not in JS after the query.
- [ ] Errors thrown as `AppError`, response through `withApiHandler`.
- [ ] Audit row written in the same transaction as the state change.
- [ ] Balance update only for the request's own `leave_type_id`; Unpaid untouched.
- [ ] Loading/empty/error/disabled UI states.
- [ ] No `console.log`; structured log with request id.

## 4. Validate

- Run the full gate.
- Exercise the negative path manually: wrong role, non-direct-report request, reversed dates,
  double accrual.
- Confirm the DB constraints/triggers still exist (`db/migrations` + CI assertions).
- Update `knowledge/patterns/` if you learned something reusable.

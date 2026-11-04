# Fix a bug

```
Bug: <symptom>
Expected: <behavior>
Observed: <behavior>
Route/role: <where it happens>
```

## Steps

1. Reproduce with the smallest role/record pair. For scope bugs, name the manager and the
   non-report that leaked.
2. Find the data path before changing UI: is the wrong row in the query result, in the selector, or
   only in the render?
3. Check the invariants:
   - `end_date >= start_date` on every write.
   - Manager scope in SQL.
   - `is_deleted = false` on active reads.
   - Audit rows append-only; no hard delete.
   - Balance changes only for `leave_type_id` of the request.
4. Add a failing test first when the bug is logic, not layout.
5. Fix the smallest layer that owns the bug; do not mask it in the component.
6. Run `npm run lint && npm run typecheck && npm run test && npm run build`.
7. If the bug was a missing guard, add the regression test to `knowledge/patterns/`.

## Do not

- Do not widen a role's access to make a test pass.
- Do not catch an error and return an ad-hoc JSON shape; use `AppError`.
- Do not remove an audit write to simplify a transaction.

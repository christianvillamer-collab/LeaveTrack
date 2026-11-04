# Implement a dev task

Use with `knowledge/patterns/implement-and-test.md`.

```
Task: <paste CSV row: task_id, summary, user_story, description, acceptance_criteria>
```

## Context to load first

1. `AGENTS.md` — hard constraints.
2. `docs/arch-docs/ARCH-LeaveTrack-v1.0.md` — data model/API/security.
3. The relevant `knowledge/patterns/` file (manager scope for approval work).
4. `lib/types.ts`, `lib/mock/data.ts`, and the component/page the task touches.

## Output format

```
EVALUATE
- Task:
- Touches:
- Depends on:
- Constraints:
- Risk:

PLAN
- API contract:
- DB change:
- UI change:
- Tests:
- Out of scope:

APPLY
- Files changed:
- Commands run:

VALIDATE
- lint / typecheck / test / build:
- Manual negative path:
- Remaining risk:
```

## Hard rules

- Do not hard-delete leave requests or audit rows.
- Do not filter manager scope in the browser.
- Do not touch a sibling leave type's balance.
- Do not log secrets, cookies, or full request bodies.
- Do not add a dependency when the standard library or an existing package covers it.

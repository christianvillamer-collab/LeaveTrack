# Knowledge index

| Path                              | What it answers                                                     |
| --------------------------------- | ------------------------------------------------------------------- |
| `rules/arch-summary.md`           | Machine-extracted architecture summary (source: `docs/arch-docs/`)  |
| `rules/coding-standards.md`       | TypeScript/Next.js/DB/UI/logging/testing conventions                |
| `design-system.md`                | Day 0 design tokens, components, states, layout, accessibility      |
| `patterns/implement-and-test.md`  | E→P→A→V chain used for every task                                   |
| `patterns/manager-scope.md`       | Security-critical SQL scoping pattern + required tests              |
| `patterns/auth-session.md`        | Verified identity → DB role mapping, fail-closed rules + tests      |
| `patterns/accrual-idempotency.md` | Ledger-based monthly accrual, atomic credit, required tests         |
| `patterns/api-endpoint.md`        | Template for Day 1 route handlers                                   |
| `prompts/dev/implement-task.md`   | Prompt for a CSV task                                               |
| `prompts/dev/fix-bug.md`          | Prompt for a defect                                                 |
| `retros/day0-scaffold.md`         | Day 0 validation results and non-blocking backlog                   |
| `retros/task-011.md`              | TASK-011 acceptance results and deferred manager-queue work         |
| `retros/task-012.md`              | TASK-012 balance results, accrual-timestamp caveat, backlog         |
| `retros/task-013.md`              | TASK-013 manager queue results, HR boundary, backlog                |
| `retros/task-014.md`              | TASK-014 decision results, over-balance/HR boundary, backlog        |
| `retros/task-015.md`              | TASK-015 audit report results, soft-delete proof, reference caveat  |
| `retros/task-016.md`              | TASK-016 mobile matrix, 375px form/balance results, hardening notes |
| `retros/task-017.md`              | TASK-017 accrual ledger, idempotency proof, cron auth, backlog      |
| `retros/task-018.md`              | TASK-018 per-type isolation proof, Unpaid bypass, test gotchas      |

Source documents remain authoritative:

- `docs/brd/BRD-LeaveTrack-v1.0.md`
- `docs/prd/PRD-LeaveTrack-v1.0.md`
- `docs/arch-docs/ARCH-LeaveTrack-v1.0.md`
- `docs/arch-docs/ADR-LeaveTrack-E001-Auth-Session-Strategy.md`
- `docs/dev-tasks/epic-1-leave-request-tasks.csv`

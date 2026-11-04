# TASK-016 validation — Mobile-responsive submit + balance pages

## Result

- `npm run build` ✅
- `npm run lint` / `typecheck` / `format:check` ✅
- `npm test` ✅ 31 passed, 15 integration tests skipped
- Layout matrix ✅ `/requests/new`, `/balance`, and `/dashboard` for an employee, plus `/balance` for
  a manager, at 320, 375, 768, 1024, and 1440: `scrollWidth === clientWidth` and zero
  out-of-viewport elements
- Consumer regression ✅ `/login` (no session) and `/audit` (HR) are also clean at 320–1440 after
  the shared `Input` change
- 375px measurements ✅ form controls render at 301px inside the 343px content column; the balance
  grid and stacked pending list render at 343px / 341px
- Interaction at 375 ✅ leave type, both dates, and reason accept input; client validation blocks an
  empty submit, renders three `role="alert"` messages, and focuses `startDate`
- Graph ✅ changes stay inside the existing `dashboard/page.tsx` and `cn` communities; `BalanceCard`
  remains shared with `/dashboard` and was re-checked there

## Acceptance criteria

- AC1 — PASS: `/requests/new` has no horizontal scroll at 375px; every control is visible within the
  viewport and the submit/cancel row stacks full width. The date pair already collapses to one
  column below `sm`.
- AC2 — PASS: `/balance` renders as a single column at 320/375 with the balance cards, pending-card
  list, and accrual policy stacked; the desktop table stays hidden below `xl`. The manager view
  (5-item bottom nav) also has no overflow.

## Changes

- `components/ui/input.tsx` — added `min-w-0 max-w-full` so native `type="date"` controls can shrink
  inside narrow grid/flex cells. Also benefits login and audit inputs.
- `components/domain/request-form.tsx` — added `min-w-0` to the date-pair grid and both date `Field`
  wrappers. No validation or render-prop changes.
- `components/domain/balance-card.tsx` — the badge/accrual header now wraps (`flex-wrap` with
  row/column gaps) and the accrual caption can shrink, so a long label cannot force overflow at
  320px. Re-checked on `/dashboard`, its other consumer.

The baseline measurement was already clean; these are defensive hardening changes for the native
date input and long-label case, not fixes for an observed 375px failure.

## Verification method

The check used a temporary Node CDP script (outside the repo, not committed) against a production
`next start` on port 3100. It sets the mock session cookies, emulates each viewport, then compares
`document.documentElement.scrollWidth` to `clientWidth` and walks visible elements for rects outside
the viewport. It also drives the form and captures 375px screenshots. Keeping this out of the repo
avoids adding a macOS/Chrome-only dependency to CI.

## Backlog

- [ ] No committed browser regression test; the layout matrix is manual/temporary. Revisit if a
      cross-platform browser harness (Playwright) is approved.
- [ ] Headless Chrome only; iOS Safari's native date-picker rendering and the 320px case on a real
      device were not exercised.
- [ ] The 5-item manager/HR bottom nav fits at 75px per item at 375 with single-line labels
      ("Home", "Requests", "Request", "Balance", "Approvals"); re-check if a sixth item is added.

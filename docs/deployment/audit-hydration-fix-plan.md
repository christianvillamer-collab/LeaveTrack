# Deployment plan — audit timestamp hydration fix

**Date:** 2026-11-18  
**Status:** Approved. Cron fix pending merge; no production deploy has been performed.

## 1. Goal

Remove the React `#418` hydration error on `/audit` (and every other surface that
renders `formatDateTime`) by formatting instants in UTC on both the server and the
browser. Also verify that Vercel is serving the intended commit, since the live
build currently appears to predate the merged E2-11 HR-override work.

## 2. Repo context

- **Runtime:** Node.js ≥ 22.12 (CI uses 22)
- **Framework:** Next.js 16.4.6 App Router, TypeScript, Tailwind v4, Turbopack build
- **CI/CD:** GitHub Actions — `.github/workflows/ci.yml` (quality + DB) and
  `.github/workflows/load-800.yml` (weekly/manual E2-14 harness). CI runs on PRs
  and on pushes to `main`; a branch push alone does not trigger it.
- **Deployment target:** Vercel (`https://leave-track-psi.vercel.app/`).
  `vercel.json` keeps the monthly `/api/jobs/accrual` cron and schedules
  `/api/jobs/notifications` daily. Vercel Hobby rejects the former `*/15 * * * *`
  expression; both jobs require the `CRON_SECRET` environment variable.
- **Data/identity:** Supabase Auth + Supabase Postgres. The app uses the pooled
  connection string; migrations/seed/tests require the direct owner connection.
  `.env.local` and `.env.github` are gitignored and must stay local.

## 3. Change inventory

| File                                          | Change                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lib/utils/format.ts`                         | `formatDateTime()` uses an explicit UTC `Intl.DateTimeFormat` instead of local-time `date-fns format`.          |
| `tests/format.test.ts`                        | Regression test switches `TZ` between `Asia/Manila` and `America/Los_Angeles` and asserts identical UTC output. |
| `vercel.json`                                 | Change the notifications cron from `*/15 * * * *` to the Hobby-compatible `0 6 * * *`.                          |
| `docs/deployment/audit-hydration-fix-plan.md` | This plan.                                                                                                      |
| `README.md`                                   | Describe the daily Vercel notifications cron.                                                                   |

No schema changes, migrations, seed changes, or dependency changes are introduced.
No new environment variable names are introduced: `CRON_SECRET` already exists in
the app but must be set in Vercel Production for the cron endpoints to run.

## 4. Branch and PR strategy

- PR #19 is **merged** and its head branch `feat/e2-13-list-pagination` was deleted
  on the remote. Do not try to push into that closed PR.
- `main` is still the initial scaffold and does **not** contain the stacked work.
  Do not deploy from `main`.
- The current integration branch is `feat/e2-11-over-balance-override`.
- Work is on `fix/audit-hydration-utc`, branched from the latest
  `origin/feat/e2-11-over-balance-override`. Push that branch and open a PR **into
  `feat/e2-11-over-balance-override`** so CI runs. Merge only after both CI jobs
  are green.

## 5. Pre-deploy checklist

- [ ] Full local gate passes, in order:
      `npm run lint && npm run typecheck && npm run test && npm run build`
      (expected: 198 passing unit tests; DB suites are separate via `npm run test:db`).
- [ ] Browser smoke on a local production build with a non-UTC browser timezone:
      sign in as HR, open `/audit`, confirm **0 console errors** and UTC timestamps.
- [ ] PR merged; record the merge commit SHA. The cron change in this PR must be
      merged first — otherwise Vercel will keep rejecting every new deployment.
- [ ] Vercel Production has `CRON_SECRET` set; both cron routes fail closed with
      503 when it is missing.
- [ ] Vercel deployment for that exact SHA is `Ready`; confirm the SHA shown in the
      deployment matches the merge commit.
- [ ] Vercel → Project Settings → Environment Variables contains (values checked,
      never pasted into a doc or issue):
      `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `DIRECT_URL`,
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`.
- [ ] Supabase Auth URL configuration allows the production callback
      `https://leave-track-psi.vercel.app/auth/callback`.
- [ ] Decide separately whether production email is in scope. `EMAIL_TRANSPORT`,
      `EMAIL_API_KEY`, and `EMAIL_FROM` were only set in local `.env.local`;
      `onboarding@resend.dev` delivers only to the registered Resend address, so
      real recipients need a verified domain.

## 6. Deployment steps

1. Merge `fix/audit-hydration-utc` → `feat/e2-11-over-balance-override`.
2. In Vercel, confirm the Production branch/source is
   `feat/e2-11-over-balance-override` (not `main`), then deploy the merge commit.
   Use **Redeploy → use existing build cache off** if a prior build might be stale.
3. Wait for `Ready` and verify the deployment SHA before testing.
4. Do not run migrations or `auth:seed` as part of this deploy; neither is needed
   for a formatting-only change.

## 7. Post-deploy verification

- [ ] `GET /api/health` → 200, `checks.database: "ok"`. (The static
      `checks.auth: "mock"` label is not a real auth indicator.)
- [ ] `/login` loads; sign in as employee, manager, and HR demo accounts.
- [ ] Employee submits a request; manager sees it in the direct-report queue and
      approves; HR sees the org-wide audit row.
- [ ] HR `/approvals` Action filter shows the HR override options — confirms the
      deployed bundle includes the merged E2-11 work.
- [ ] HR `/audit` with browser timezone `Asia/Manila` (or a DevTools timezone
      override): **0 console errors**, no React `#418`, timestamps in UTC.
- [ ] Vercel Runtime Logs show no new hydration or auth errors during the smoke.
- [ ] Cron endpoints return 401/503 without the bearer secret and 200 with it;
      the notification outbox rows are `sent`/`skipped` as expected.
- [ ] Vercel Cron Jobs lists both schedules: monthly `/api/jobs/accrual` and daily
      `/api/jobs/notifications` (`0 6 * * *`).

## 8. Rollback

- No database rollback is required — this change touches rendering, tests, and
  scheduling config only.
- In Vercel, **Promote to Production** the previous known-good deployment (or
  redeploy the previous SHA). Confirm `/api/health` and `/audit` afterward.
- If a verification failure is caused by environment configuration, correct the
  Vercel variable and redeploy rather than reverting code.

## 9. Residual risks

- Timestamps now display UTC everywhere `formatDateTime` is used; users in other
  timezones will see values offset from local time. This is intentional for
  audit/compliance consistency and SSR parity.
- The demo leave requests already changed during browser testing (one approved,
  one HR-override-rejected) and the E2-14 load-test Auth users remain in Supabase.
  This deploy neither cleans up nor depends on that data.
- Notifications are drained at most once per day on the Vercel Hobby plan; the
  in-app rows still appear immediately, but email delivery can be delayed by up
  to a day. If `CRON_SECRET` is removed or rotated without updating Vercel, both
  cron endpoints fail closed.
- E2-14's p95 and zero-error acceptance criteria remain unmet; this fix does not
  address them.

# ADR-LeaveTrack-E003 — Auth Provider

**Status:** Accepted — Supabase Auth (`@supabase/ssr`); E2-02 implements it

## Context

The Day 0 scaffold uses a mock httpOnly cookie session (`mock-role`, `mock-user`, `mock-email`) and accepts any email/password. `ADR-LeaveTrack-E001` decides only that mock strategy and states that Day 1 replaces _how the cookie is issued_; it does not name a provider.

`ARCH-LeaveTrack-v1.0.md` names Next.js/Vercel as the app platform and Supabase as managed Postgres. `README.md` lists "Supabase Auth" and "OAuth" as external services that are **not** in use today. The scaffold command lists Supabase Auth, NextAuth, and OAuth as Day 1 candidates, but explicitly says not to implement them on Day 0.

The organisation is ~800 staff, with roughly 30% mobile-only. Roles are `employee`, `manager`, and `hr_admin`. The app needs server-side session reads in `proxy.ts` and server components, role-gating, and a stable mapping from the authenticated identity to the `users` row.

## Decision drivers

1. Does the organisation already have a standard identity provider (Microsoft 365/Entra ID, Google Workspace, Okta)?
2. Is SSO, MFA, or conditional access mandatory?
3. Session shape that works with `proxy.ts` and server components.
4. Mapping to `users` and compatibility with the DB authorization model (`ADR-E004`).
5. Migration effort, operating cost, and vendor lock-in.
6. Password reset, email verification, and account deprovisioning.

## Options

### 1. Supabase Auth

- **Pros:** same vendor as the Postgres deployment; built-in email/password and OAuth; JWT integrates with Supabase RLS; no extra identity infrastructure; lowest setup cost.
- **Cons:** vendor coupling; enterprise SSO/SAML may require a higher plan; the session/JWT shape differs from the current 8h cookie; role claims need custom claims or a DB lookup.
- **Best fit:** no org-wide SSO mandate and the team wants the shortest path.

### 2. Auth.js / NextAuth

- **Pros:** framework-native for Next.js; broad provider support; database session adapter; full control of the session and cookie shape; no identity vendor lock-in.
- **Cons:** more wiring (adapter, schema, callbacks); no out-of-the-box RLS integration; the security surface is owned by the team.
- **Best fit:** the org wants provider flexibility and a custom session model.

### 3. Entra ID / OIDC SSO

- **Pros:** leverages the existing Microsoft 365 identity if that is the org standard; centralised MFA, conditional access, and offboarding; strong enterprise governance.
- **Cons:** tenant/app registration and group-to-role mapping; heavier setup; some capabilities depend on licence tier.
- **Best fit:** the org mandates SSO or already standardises on Microsoft 365.

## Decision

**Supabase Auth**, integrated with `@supabase/ssr` (pinned `0.12.7`) and `@supabase/supabase-js` (pinned `2.119.0`).

Rationale:

- The database and deployment target are already Supabase/Vercel, so this adds the fewest moving parts and no new vendor.
- The repository contains no evidence of an org-wide SSO/M365 mandate, so Entra ID/OIDC's heavier tenant/app-registration and group-mapping work is not justified yet. If the organisation later standardises on Microsoft 365, this decision is revisited and the session/identity steps carry over.
- `@supabase/ssr` issues httpOnly cookies that `proxy.ts` and Server Components can read, which preserves the ADR-E001 guard shape: only the cookie **issuer** changes.
- Built-in email/password, email verification, password reset, and account deprovisioning cover the E2-02 scope without custom security code.

Rejected options:

- **Auth.js / NextAuth** — more wiring (adapter, schema, callbacks) and the team would own the full session security surface for no capability the app needs now.
- **Entra ID / OIDC** — rejected for now; requires an org tenant decision and adds group-to-role mapping. Revisit if SSO/MFA/conditional access becomes mandatory.

### Session and token shape

- Supabase issues an access/refresh token pair stored in httpOnly, `SameSite=Lax`, `Secure` (production) cookies by `@supabase/ssr`. `proxy.ts` refreshes them on every matched request and copies any rotated cookies onto the response.
- `getSession()` verifies the user with Supabase (`auth.getUser()`), requires a confirmed email, then maps the verified email to a `users` row. It returns the same `{ role, name, email }` shape the rest of the app already consumes.
- Provider claims are **not** an authorization source. The role and display name come from the DB `users` row (`ADR-E004`).
- Identity mapping is a case-insensitive unique email match against the existing `users_email_lower_unique` index. A stable `auth_subject` column is deferred: it must survive email changes, which is a future migration rather than part of E2-02.
- Unlinked or unconfirmed identities are denied: the login action signs them out and reports "No employee record is linked to this account."

### Migration and rollback

- Cutover: configure `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, run `npm run auth:seed` once in non-production to create confirmed provider users that match the seeded `users` emails, then deploy.
- The three `mock-*` cookies are deleted from the codebase; there is no accepted-credential path in production.
- Rollback: revert the E2-02 commits. The DB schema is unchanged (no migrations), and the previous mock login is restored with the revert. Existing Supabase Auth users are unused by the reverted code and can be deleted.
- Removing a person from the `users` table denies access on the next request even if their provider session is still valid.

## Consequences

- The `proxy.ts` guard, `getSession()`, `requireRole()`, and `canAccessPath()` shapes should remain; only the session issuer changes.
- Add a stable `auth_subject` (or provider user id) to `users`, or require a unique case-insensitive email match. Prefer an explicit subject column to survive email changes.
- The DB `users.role` remains the authorization source of truth; provider role claims are not trusted for authorization.
- Document the cutover and rollback: how existing mock users map to real identities, how sessions are invalidated, and how to revert to the mock in local development.

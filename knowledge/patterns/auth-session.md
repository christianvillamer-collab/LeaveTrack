# Verified identity → DB role (security-critical)

BR-02 / E2-02 / `ADR-LeaveTrack-E003` + `ADR-LeaveTrack-E004`: the auth provider proves
**who** a person is. It never decides **what they may do**. Role and record scope come from the
database.

The failure mode this pattern prevents: trusting a provider claim, an app-metadata field, or a
client-supplied role/cookie to grant `hr_admin` or manager scope.

## Rule

```
provider session ──► verified email ──► users.email (case-insensitive) ──► users.role, users.name
```

1. **Verify with the provider.** `getSession()` calls `supabase.auth.getUser()`, which revalidates
   the session with Supabase Auth. Never read the session payload from a cookie and trust it.
2. **Require a confirmed email.** `email_confirmed_at` must be set; an unconfirmed identity is
   unauthenticated.
3. **Map to exactly one `users` row.** `findUserByEmail` does
   `where lower(email) = lower($1) limit 1`, backed by `users_email_lower_unique`. No row means no
   access — sign the provider session out.
4. **Take role and name from the row.** Return `{ role: user.role, name: user.name, email: user.email }`.
   Provider `user_metadata`, `app_metadata`, and any cookie role are ignored.
5. **Authorization stays downstream.** `requireRole` gates pages; route handlers and SQL gates
   records (`WHERE manager_id = :current_user_id`). `proxy.ts` is only an authentication gate.

```ts
// lib/auth/session.ts (shape)
const { data, error } = await supabase.auth.getUser();
if (error || !data.user) return null;

const email = data.user.email?.trim();
if (!email || !data.user.email_confirmed_at) return null;

const user = await findUserByEmail(email); // DB is authoritative
if (!user) return null;

return { role: user.role, name: user.name, email: user.email };
```

## Failure behaviour (fail closed)

| Situation                          | Result                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Auth env missing                   | login shows a configuration notice; protected APIs return `503 SERVICE_UNAVAILABLE` |
| No/expired session                 | pages redirect to `/login`; APIs return `401 UNAUTHENTICATED`                       |
| Unconfirmed email                  | treated as unauthenticated                                                          |
| Verified email with no `users` row | provider session signed out; login reports the account is not linked                |
| DB lookup throws                   | provider session signed out; login reports a retry message (logged, not leaked)     |

Removing a person from `users` revokes access on the next request even while their provider session
is still valid. That is intentional: the DB row is the access list.

## Provider and proxy notes

- `@supabase/ssr` stores the session in httpOnly, `SameSite=Lax`, `Secure`-in-production cookies.
- `proxy.ts` calls `auth.getClaims()` (asymmetric JWTs verify locally; symmetric projects fall back
  to the auth server) and copies rotated cookies, **including Supabase's no-store headers**, onto the
  response. Dropping those headers would let a CDN serve one user's session to another.
- `proxy.ts` defaults to the Node.js runtime in Next 16 and must not set the `runtime` config.
- Route handlers that exchange a provider code (`/auth/callback`) are public and must map the
  verified email **before** redirecting into the app.

## Identity mapping is email-based — known limit

This is a case-insensitive unique email match. A stable `auth_subject` column is deferred because it
becomes necessary only when an employee changes their email. If you add it, store the provider
`sub` on first login and map on that instead; keep email as a fallback only during migration.

## Tests that must exist

1. `getSession()` returns the **DB** role/name, even when the provider carries a different
   `role` in `user_metadata`/`app_metadata`.
2. No configured provider → `null` with no DB lookup.
3. Provider error, missing user, missing email, or unconfirmed email → `null`.
4. Verified email with no `users` row → `null`.
5. `requireRole` redirects a DB role that is not allowed to `/forbidden`.
6. Proxy: public paths bypass auth; unauthenticated API → `401`; unauthenticated page → `/login`
   with `next`; missing auth config → `503` (API) / redirect (page); configured + valid claims
   returns the refreshed response.
7. Integration: `findUserByEmail` resolves mixed-case email to one row and relies on
   `users_email_lower_unique`.

See `lib/auth/supabase.ts`, `lib/auth/session.ts`, `proxy.ts`, `app/auth/callback/route.ts`,
`tests/auth-session.test.ts`, `tests/proxy-auth.test.ts`, and
`tests/auth-identity.integration.test.ts`.

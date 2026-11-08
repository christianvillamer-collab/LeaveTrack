import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Reads the public Supabase Auth configuration. Both values are safe to ship
 * to the browser: the anon key is protected by row-level security, and this
 * app never trusts a provider claim for authorization (ADR-E004).
 */
function authCredentials(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export class AuthConfigurationError extends Error {
  constructor() {
    super(
      "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "AuthConfigurationError";
  }
}

/** Builds must succeed with an empty environment, so callers check this first. */
export function isAuthConfigured(): boolean {
  return authCredentials() !== null;
}

function requireAuthCredentials() {
  const credentials = authCredentials();

  if (!credentials) {
    throw new AuthConfigurationError();
  }

  return credentials;
}

/**
 * Client for Server Components, Server Actions, and Route Handlers.
 *
 * In a Server Component `cookieStore.set` throws; the auth cookies are refreshed
 * by `proxy.ts` on every matched request instead. Server Actions and Route
 * Handlers can write cookies, so sign-in, sign-out, and the OAuth callback work
 * here.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = requireAuthCredentials();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, _headers) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. The proxy refreshes the session.
        }
      },
    },
  });
}

/**
 * Client for `proxy.ts`. Token refreshes are written onto the response that
 * replaces the incoming request, including the no-store headers Supabase
 * requires, so a CDN never serves one user's session to another.
 */
export function createSupabaseProxyClient(request: NextRequest) {
  const { url, anonKey } = requireAuthCredentials();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  return { supabase, response: () => response };
}

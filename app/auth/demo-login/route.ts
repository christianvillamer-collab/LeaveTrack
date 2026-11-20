import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { POST as loginWithPassword } from "@/app/auth/login/route";
import { DEMO_ACCOUNTS, DEMO_ACCOUNT_IDS } from "@/lib/auth/demo-accounts";

export const runtime = "nodejs";

const demoLoginSchema = z.object({
  account: z.enum(DEMO_ACCOUNT_IDS),
  next: z.string().optional(),
});

function noStore(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  return headers;
}

function unavailable(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStore() });
}

function demoLoginEnabled(): boolean {
  return process.env.DEMO_LOGIN_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * One-click sign-in for the seeded demo accounts.
 *
 * The browser only sends an allowlisted account id. This route resolves the
 * email and adds the server-only demo password before delegating to the normal
 * password login handler, so every existing check (confirmed email, employee
 * record, active status, subject linking, safe redirect) still applies and the
 * password never reaches the browser.
 */
export async function POST(request: NextRequest) {
  if (!demoLoginEnabled()) {
    return unavailable("Demo sign-in is not available.", 404);
  }

  const password = process.env.DEMO_LOGIN_PASSWORD;

  if (!password) {
    return unavailable("Demo sign-in is not configured. Contact an administrator.", 503);
  }

  const parsed = demoLoginSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return unavailable("Choose a valid demo account.", 400);
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");

  const loginRequest = new NextRequest(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: DEMO_ACCOUNTS[parsed.data.account].email,
      password,
      next: parsed.data.next,
    }),
  });

  return loginWithPassword(loginRequest);
}

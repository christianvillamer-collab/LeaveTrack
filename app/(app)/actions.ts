"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase";
import { logger } from "@/lib/logging/logger";

export async function signOut() {
  if (isAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      // Still send the user to /login: the client clears local session cookies
      // even when the revoke call fails, and a stuck session is worse.
      logger.warn({ err: error }, "auth.sign_out_failed");
    }
  }

  redirect("/login");
}

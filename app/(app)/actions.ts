"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase";
import { logger } from "@/lib/logging/logger";

export async function signOut() {
  if (isAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    // `local` removes this device's cookies before the revoke request, so a
    // network or 5xx failure cannot leave a usable session behind. The default
    // `global` scope returns early on such errors without clearing storage.
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      logger.warn({ err: error }, "auth.sign_out_failed");
    }
  }

  redirect("/login");
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, SESSION_EMAIL_COOKIE, SESSION_NAME_COOKIE } from "@/lib/auth/session";

export async function signOut() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(SESSION_NAME_COOKIE);
  store.delete(SESSION_EMAIL_COOKIE);
  redirect("/login");
}

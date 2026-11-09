import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/lib/auth/session";

// Session reads must happen at request time. Without this, a build with an
// empty auth environment prerenders these routes as `307 -> /login`, and a
// later build with runtime secrets would serve that redirect from cache.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return <AppShell session={session}>{children}</AppShell>;
}

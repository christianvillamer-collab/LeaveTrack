import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/lib/auth/session";
import { countUnreadNotifications } from "@/lib/db/notifications";

// Session reads must happen at request time. Without this, a build with an
// empty auth environment prerenders these routes as `307 -> /login`, and a
// later build with runtime secrets would serve that redirect from cache.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  let unreadNotifications = 0;

  try {
    unreadNotifications = await countUnreadNotifications(session.id);
  } catch {
    // The badge is decoration: a database hiccup must not take down every page
    // in the shell. The notifications page reports the real error itself.
  }

  return (
    <AppShell session={session} unreadNotifications={unreadNotifications}>
      {children}
    </AppShell>
  );
}

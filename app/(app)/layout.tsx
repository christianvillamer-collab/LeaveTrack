import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/lib/auth/session";
import { countUnreadNotifications } from "@/lib/db/notifications";

// Session reads must happen at request time. Without this, a build with an
// empty auth environment prerenders these routes as `307 -> /login`, and a
// later build with runtime secrets would serve that redirect from cache.
export const dynamic = "force-dynamic";

// The badge is decoration. A slow or wedged pooled connection must not hold the
// whole App Router stream open until the platform timeout, so bound the read.
const BADGE_QUERY_TIMEOUT_MS = 3000;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  let unreadNotifications = 0;
  try {
    unreadNotifications = await countUnreadNotifications(
      session.id,
      AbortSignal.timeout(BADGE_QUERY_TIMEOUT_MS),
    );
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

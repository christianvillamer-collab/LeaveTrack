import type { Session } from "@/lib/auth/session";

import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ session, children }: { session: Session; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <Sidebar name={session.name} email={session.email} role={session.role} />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <MobileNav name={session.name} email={session.email} role={session.role} />
        <TopBar name={session.name} role={session.role} />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pt-8 lg:pb-10"
        >
          {children}
        </main>
        <footer className="border-border text-caption text-muted-foreground hidden border-t px-6 py-4 lg:block xl:px-8">
          LeaveTrack · Mock auth · Submission and balances are live; other demo data is mocked
        </footer>
      </div>
    </div>
  );
}

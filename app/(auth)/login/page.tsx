import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarCheck2, Clock3, ShieldCheck, Sparkles } from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/auth/roles";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to LeaveTrack.",
};

const proofPoints = [
  {
    icon: Clock3,
    title: "One place for every request",
    body: "No more email threads or shared spreadsheets to track who is away.",
  },
  {
    icon: ShieldCheck,
    title: "Scoped by design",
    body: "Managers only ever see requests from their own direct reports.",
  },
  {
    icon: CalendarCheck2,
    title: "Audit-ready records",
    body: "Every submission and decision is retained for compliance reviews.",
  },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) {
    redirect(ROLE_HOME);
  }

  const { next } = await searchParams;

  return (
    <main id="main-content" className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="bg-sidebar relative hidden flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,hsl(164_45%_24%),transparent_45%),radial-gradient(circle_at_85%_85%,hsl(164_50%_18%),transparent_50%)]"
        />
        <div className="relative">
          <Brand />
        </div>

        <div className="relative max-w-md space-y-8">
          <Badge variant="primary" className="bg-sidebar-active text-sidebar-foreground">
            <Sparkles aria-hidden="true" className="size-3.5" />
            Day 0 preview
          </Badge>
          <div className="space-y-4">
            <h1 className="text-display text-sidebar-foreground">
              Leave, without the inbox archaeology.
            </h1>
            <p className="text-body text-sidebar-muted">
              Submit requests, see exactly what is left, and give managers a queue that only
              contains their own team.
            </p>
          </div>

          <ul className="space-y-5">
            {proofPoints.map((point) => {
              const Icon = point.icon;
              return (
                <li key={point.title} className="flex gap-3.5">
                  <span className="bg-sidebar-active text-sidebar-foreground mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md">
                    <Icon aria-hidden="true" className="size-4.5" />
                  </span>
                  <div>
                    <p className="text-small text-sidebar-foreground font-semibold">
                      {point.title}
                    </p>
                    <p className="text-caption text-sidebar-muted mt-0.5">{point.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-caption text-sidebar-muted relative">
          LeaveTrack v1.0 · Internal people operations
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-start gap-3 lg:hidden">
            <Brand variant="light" />
          </div>

          <div className="space-y-2">
            <Badge variant="primary" className="lg:hidden">
              Day 0 preview
            </Badge>
            <h1 className="text-h1 text-foreground">Welcome back</h1>
            <p className="text-small text-muted-foreground">
              Sign in with any email and password to explore a role.
            </p>
          </div>

          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}

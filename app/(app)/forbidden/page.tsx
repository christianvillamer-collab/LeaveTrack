import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Access denied" };

export default async function ForbiddenPage() {
  const session = await requireSession();

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 py-10 text-center sm:py-16">
      <span className="bg-danger-subtle text-danger-foreground flex size-16 items-center justify-center rounded-xl">
        <ShieldAlert aria-hidden="true" className="size-8" />
      </span>
      <div className="space-y-2">
        <p className="text-caption text-danger-foreground font-semibold tracking-wide uppercase">
          403 · Forbidden
        </p>
        <h1 className="text-h1 text-foreground">This area is not in your scope</h1>
        <p className="text-small text-muted-foreground">
          You are signed in as <strong>{ROLE_LABELS[session.role]}</strong>. Managers can only
          review their direct reports, and audit or policy pages are limited to HR Admins.
        </p>
      </div>

      <Card className="w-full p-5 text-left">
        <p className="text-small text-foreground">
          If you believe you should have access, contact People Operations. Scoping is enforced on
          the server — no client-side toggle can open this page.
        </p>
      </Card>

      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard">
            <ArrowLeft aria-hidden="true" />
            Back to dashboard
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/requests">My requests</Link>
        </Button>
      </div>
    </div>
  );
}

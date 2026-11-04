import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center"
    >
      <span className="bg-primary-subtle text-primary-subtle-foreground flex size-14 items-center justify-center rounded-xl">
        <CalendarDays aria-hidden="true" className="size-7" />
      </span>
      <div className="space-y-2">
        <p className="text-caption text-muted-foreground font-semibold tracking-wide uppercase">
          404
        </p>
        <h1 className="text-h1 text-foreground">Page not found</h1>
        <p className="text-small text-muted-foreground mx-auto max-w-md">
          The page you are looking for has moved or never existed. Your leave data is safe.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </main>
  );
}

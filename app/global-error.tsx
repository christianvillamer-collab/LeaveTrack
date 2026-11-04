"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logged the original error with a request id. The
    // digest is the only safe correlation value exposed to the client.
    if (error.digest) {
      window.console.error(`Unhandled application error (digest: ${error.digest})`);
    }
  }, [error.digest]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main
          id="main-content"
          className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center"
        >
          <span className="bg-danger-subtle text-danger-foreground flex size-14 items-center justify-center rounded-xl">
            <AlertTriangle aria-hidden="true" className="size-7" />
          </span>
          <div className="space-y-2">
            <h1 className="text-h1">Something went wrong</h1>
            <p className="text-small text-muted-foreground mx-auto max-w-md">
              The application hit an unexpected error. Try again, or return to the dashboard.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="secondary">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}

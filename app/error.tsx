"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (error.digest) {
      window.console.error(`Route error (digest: ${error.digest})`);
    }
  }, [error.digest]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-16 text-center">
      <span className="bg-danger-subtle text-danger-foreground flex size-14 items-center justify-center rounded-xl">
        <AlertTriangle aria-hidden="true" className="size-7" />
      </span>
      <div className="space-y-2">
        <h1 className="text-h2">This page could not load</h1>
        <p className="text-small text-muted-foreground">
          Nothing was saved or changed. Retry the page, or contact People Operations if it keeps
          happening.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

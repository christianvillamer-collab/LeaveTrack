import { CalendarCheck2 } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

export function Brand({
  variant = "dark",
  compact = false,
}: {
  variant?: "dark" | "light";
  compact?: boolean;
}) {
  return (
    <Link
      href="/dashboard"
      className={cn(
        "focus-visible:ring-ring flex items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        variant === "dark" ? "text-sidebar-foreground" : "text-foreground",
      )}
    >
      <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg shadow-sm">
        <CalendarCheck2 aria-hidden="true" className="size-5" />
      </span>
      {!compact ? (
        <span className="flex flex-col">
          <span className="text-body leading-none font-bold tracking-tight">LeaveTrack</span>
          <span
            className={cn(
              "text-caption mt-1",
              variant === "dark" ? "text-sidebar-muted" : "text-muted-foreground",
            )}
          >
            People Operations
          </span>
        </span>
      ) : null}
    </Link>
  );
}

export function PreviewBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={className}
      title="Mock auth and demo data; submissions and balances use Postgres"
    >
      <span aria-hidden="true" className="bg-warning size-1.5 rounded-full" />
      Day 0 preview
    </Badge>
  );
}

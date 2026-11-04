import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border bg-surface-muted/60 flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <span className="bg-surface text-muted-foreground flex size-12 items-center justify-center rounded-full shadow-xs">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-small text-foreground font-semibold">{title}</p>
        <p className="text-caption text-muted-foreground mx-auto max-w-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}

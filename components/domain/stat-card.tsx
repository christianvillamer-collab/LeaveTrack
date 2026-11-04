import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

const tones = {
  primary: "bg-primary-subtle text-primary-subtle-foreground",
  info: "bg-info-subtle text-info-foreground",
  success: "bg-success-subtle text-success-foreground",
  warning: "bg-warning-subtle text-warning-foreground",
  danger: "bg-danger-subtle text-danger-foreground",
  neutral: "bg-muted text-muted-foreground",
} as const;

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: keyof typeof tones;
}

export function StatCard({ label, value, hint, icon: Icon, tone = "primary" }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-caption text-muted-foreground font-medium">{label}</p>
          <p className="text-h2 text-foreground tabular-nums">{value}</p>
          {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
        </div>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md",
            tones[tone],
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </Card>
  );
}

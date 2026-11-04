import { CheckCircle2, MessageSquare, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AuditEvent } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

const config = {
  submitted: { icon: MessageSquare, tone: "bg-muted text-muted-foreground" },
  approved: { icon: CheckCircle2, tone: "bg-success-subtle text-success-foreground" },
  rejected: { icon: XCircle, tone: "bg-danger-subtle text-danger-foreground" },
} as const;

export function AuditTrail({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <p className="text-small text-muted-foreground">No audit events recorded yet.</p>;
  }

  return (
    <ol className="border-border relative space-y-5 border-l pl-5">
      {events.map((event) => {
        const item = config[event.action];
        const Icon = item.icon;
        return (
          <li key={event.id} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                "ring-surface absolute top-0 -left-[2.05rem] flex size-8 items-center justify-center rounded-full ring-4",
                item.tone,
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    event.action === "approved"
                      ? "success"
                      : event.action === "rejected"
                        ? "danger"
                        : "neutral"
                  }
                  className="capitalize"
                >
                  {event.action}
                </Badge>
                <span className="text-caption text-muted-foreground">
                  {formatDateTime(event.occurredAt)}
                </span>
              </div>
              <p className="text-small text-foreground">{event.detail}</p>
              <p className="text-caption text-muted-foreground">Recorded by {event.actor.name}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

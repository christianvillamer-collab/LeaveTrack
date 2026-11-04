import { CheckCircle2, Clock3, XCircle } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/types";

const config = {
  pending: { label: "Pending", variant: "warning", icon: Clock3 },
  approved: { label: "Approved", variant: "success", icon: CheckCircle2 },
  rejected: { label: "Rejected", variant: "danger", icon: XCircle },
} as const satisfies Record<
  RequestStatus,
  { label: string; variant: BadgeProps["variant"]; icon: typeof Clock3 }
>;

export function StatusBadge({ status }: { status: RequestStatus }) {
  const item = config[status];
  const Icon = item.icon;

  return (
    <Badge variant={item.variant}>
      <Icon aria-hidden="true" className="size-3.5" />
      {item.label}
    </Badge>
  );
}

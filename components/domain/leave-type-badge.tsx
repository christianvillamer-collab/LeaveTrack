import { HeartPulse, MinusCircle, Sun } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { LeaveType } from "@/lib/types";

const config = {
  Vacation: { variant: "info", icon: Sun },
  Sick: { variant: "primary", icon: HeartPulse },
  Unpaid: { variant: "neutral", icon: MinusCircle },
} as const;

export function LeaveTypeBadge({ leaveType }: { leaveType: LeaveType }) {
  const item = config[leaveType.name];
  const Icon = item.icon;

  return (
    <Badge variant={item.variant}>
      <Icon aria-hidden="true" className="size-3.5" />
      {leaveType.name}
    </Badge>
  );
}

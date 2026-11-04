import { CalendarDays } from "lucide-react";

import { PreviewBadge } from "@/components/layout/brand";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { formatDate } from "@/lib/utils/format";

export function TopBar({ name, role }: { name: string; role: Role }) {
  const today = formatDate(new Date().toISOString().slice(0, 10));

  return (
    <header className="border-border bg-background/90 sticky top-0 z-30 hidden h-16 items-center justify-between gap-4 border-b px-6 backdrop-blur lg:flex xl:px-8">
      <div className="text-small text-muted-foreground flex items-center gap-3">
        <CalendarDays aria-hidden="true" className="size-4" />
        <span>{today}</span>
        <span aria-hidden="true" className="text-border">
          /
        </span>
        <span>Mock workspace</span>
      </div>
      <div className="flex items-center gap-3">
        <PreviewBadge />
        <div className="bg-border h-6 w-px" aria-hidden="true" />
        <div className="flex items-center gap-2.5">
          <Avatar name={name} size="sm" />
          <div className="leading-tight">
            <p className="text-small text-foreground font-semibold">{name}</p>
            <p className="text-caption text-muted-foreground">{ROLE_LABELS[role]}</p>
          </div>
          <Badge variant="primary" className="ml-1">
            Demo
          </Badge>
        </div>
      </div>
    </header>
  );
}

import { Inbox } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { StatusBadge } from "@/components/domain/status-badge";
import { TeamDecisionActions } from "@/components/domain/team-decision-actions";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamLeaveRequest } from "@/lib/types";
import { formatDate, formatDateRange, formatDays } from "@/lib/utils/format";

export interface TeamRequestTableProps {
  requests: TeamLeaveRequest[];
  emptyTitle?: string;
  emptyDescription?: string;
  actionable?: boolean;
  variant?: "table" | "cards";
}

export function TeamRequestTable({
  requests,
  emptyTitle = "No requests in your scope",
  emptyDescription = "Requests from your direct reports will appear here.",
  actionable = false,
  variant = "table",
}: TeamRequestTableProps) {
  if (requests.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />;
  }

  const cards = (
    <ul className={variant === "cards" ? "space-y-3" : "space-y-3 xl:hidden"}>
      {requests.map((request) => (
        <li key={request.id} className="border-border bg-surface rounded-lg border p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={request.employee.name} size="sm" />
              <div className="min-w-0">
                <p className="text-foreground text-small truncate font-semibold">
                  {request.employee.name}
                </p>
                <p className="text-muted-foreground text-caption truncate">
                  {request.employee.email}
                </p>
              </div>
            </div>
            <StatusBadge status={request.status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <LeaveTypeBadge leaveType={request.leaveType} />
            <span className="text-muted-foreground text-caption">
              {formatDateRange(request.startDate, request.endDate)} · {formatDays(request.days)}
            </span>
          </div>
          <p className="text-foreground text-small mt-2">{request.reason}</p>
          <p className="text-muted-foreground text-caption mt-2">
            Submitted {formatDate(request.createdAt)}
          </p>
          {actionable && request.status === "pending" ? (
            <div className="mt-3">
              <TeamDecisionActions request={request} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );

  if (variant === "cards") {
    return cards;
  }

  return (
    <>
      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              {actionable ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={request.employee.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-foreground truncate font-medium">
                        {request.employee.name}
                      </p>
                      <p className="text-muted-foreground text-caption truncate">
                        {request.employee.email}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <LeaveTypeBadge leaveType={request.leaveType} />
                </TableCell>
                <TableCell className="text-foreground whitespace-nowrap">
                  {formatDateRange(request.startDate, request.endDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{request.days}</TableCell>
                <TableCell>
                  <StatusBadge status={request.status} />
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDate(request.createdAt)}
                </TableCell>
                {actionable ? (
                  <TableCell>
                    {request.status === "pending" ? (
                      <TeamDecisionActions request={request} />
                    ) : (
                      <span className="text-muted-foreground text-caption">—</span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {cards}
    </>
  );
}

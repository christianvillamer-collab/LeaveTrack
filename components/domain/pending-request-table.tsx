import { Clock3 } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { StatusBadge } from "@/components/domain/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MyLeaveRequest } from "@/lib/types";
import { formatDate, formatDateRange, formatDays } from "@/lib/utils/format";

export interface PendingRequestTableProps {
  requests: MyLeaveRequest[];
}

export function PendingRequestTable({ requests }: PendingRequestTableProps) {
  if (requests.length === 0) {
    return (
      <EmptyState
        icon={Clock3}
        title="Nothing pending"
        description="No request is currently holding part of your balance."
      />
    );
  }

  return (
    <>
      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Leave type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="text-right">Days held</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 xl:hidden">
        {requests.map((request) => (
          <li key={request.id} className="border-border bg-surface rounded-lg border p-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <LeaveTypeBadge leaveType={request.leaveType} />
                <p className="text-foreground text-small mt-2 font-semibold">
                  {formatDateRange(request.startDate, request.endDate)} · {formatDays(request.days)}
                </p>
                <p className="text-muted-foreground text-caption mt-1">
                  Submitted {formatDate(request.createdAt)}
                </p>
              </div>
              <StatusBadge status={request.status} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

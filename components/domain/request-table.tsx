import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { StatusBadge } from "@/components/domain/status-badge";
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
import type { RequestSummary } from "@/lib/types";
import { formatDateRange, formatDays } from "@/lib/utils/format";

export interface RequestTableProps {
  requests: RequestSummary[];
  showEmployee?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function RequestTable({
  requests,
  showEmployee = false,
  emptyTitle = "No leave requests yet",
  emptyDescription = "When a request is submitted it will appear here with its decision status.",
}: RequestTableProps) {
  if (requests.length === 0) {
    return <EmptyState icon={FileText} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {showEmployee ? <TableHead>Employee</TableHead> : null}
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                {showEmployee ? (
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={request.employee.name} size="sm" />
                      <div className="min-w-0">
                        <p className="text-foreground truncate font-medium">
                          {request.employee.name}
                        </p>
                        <p className="text-caption text-muted-foreground truncate">
                          {request.employee.jobTitle ?? request.employee.email ?? ""}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                ) : null}
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
                  {request.createdAt.slice(0, 10)}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/requests/${request.id}`}
                    aria-label={`View request ${request.reference}${showEmployee ? ` for ${request.employee.name}` : ""}`}
                    className="text-small text-primary hover:text-primary-hover focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
                  >
                    View
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
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
                {showEmployee ? (
                  <p className="text-small text-foreground truncate font-semibold">
                    {request.employee.name}
                  </p>
                ) : (
                  <p className="text-small text-foreground font-semibold">{request.reference}</p>
                )}
                <p className="text-caption text-muted-foreground mt-0.5">
                  {formatDateRange(request.startDate, request.endDate)} · {formatDays(request.days)}
                </p>
              </div>
              <StatusBadge status={request.status} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <LeaveTypeBadge leaveType={request.leaveType} />
              <Link
                href={`/requests/${request.id}`}
                aria-label={`View request ${request.reference}${showEmployee ? ` for ${request.employee.name}` : ""}`}
                className="text-small text-primary hover:text-primary-hover focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
              >
                View
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Eye, X } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import type { LeaveRequest } from "@/lib/types";
import { formatDateRange, formatDateTime, formatDays } from "@/lib/utils/format";

export function ApprovalCard({ request }: { request: LeaveRequest }) {
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [demoNotice, setDemoNotice] = useState(false);

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={request.employee.name} />
            <div className="min-w-0">
              <p className="text-small text-foreground truncate font-semibold">
                {request.employee.name}
              </p>
              <p className="text-caption text-muted-foreground">
                {request.employee.jobTitle} · {request.employee.team}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <LeaveTypeBadge leaveType={request.leaveType} />
                <span className="text-caption text-muted-foreground">
                  {formatDateRange(request.startDate, request.endDate)} · {formatDays(request.days)}
                </span>
              </div>
            </div>
          </div>
          <p className="text-caption text-muted-foreground whitespace-nowrap">
            Submitted {formatDateTime(request.createdAt)}
          </p>
        </div>

        <p className="bg-surface-muted text-small text-foreground mt-4 rounded-md px-3 py-2.5">
          {request.reason}
        </p>

        {demoNotice ? (
          <Alert variant="warning" className="mt-4">
            Demo mode — no decision was recorded and the balance did not change.
          </Alert>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setDecision("approved")}>
            <Check aria-hidden="true" />
            Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDecision("rejected")}>
            <X aria-hidden="true" />
            Reject
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/requests/${request.id}`}>
              <Eye aria-hidden="true" />
              View details
            </Link>
          </Button>
        </div>
      </Card>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
          }
        }}
        title={decision === "rejected" ? "Reject this request?" : "Approve this request?"}
        description={`${request.employee.name} · ${formatDateRange(request.startDate, request.endDate)} · ${formatDays(request.days)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === "rejected" ? "danger" : "primary"}
              onClick={() => {
                setDecision(null);
                setDemoNotice(true);
              }}
            >
              {decision === "rejected" ? "Confirm rejection" : "Confirm approval"}
            </Button>
          </>
        }
      >
        <div className="text-small text-muted-foreground space-y-3">
          <p>{request.reason}</p>
          <Alert variant="info">
            Day 0 preview: approving or rejecting does not persist. Day 1 adds the balance change,
            audit row, and employee notification.
          </Alert>
        </div>
      </Dialog>
    </>
  );
}

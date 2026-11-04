import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, Info, UserRound } from "lucide-react";

import { ApprovalCard } from "@/components/domain/approval-card";
import { AuditTrail } from "@/components/domain/audit-trail";
import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { StatusBadge } from "@/components/domain/status-badge";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canDecideRequest, canViewRequest } from "@/lib/auth/access";
import { requireSession } from "@/lib/auth/session";
import { auditForRequest, balancesFor, employeeFor, requestById } from "@/lib/mock/data";
import { formatDate, formatDateRange, formatDateTime, formatDays } from "@/lib/utils/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const request = requestById(id);

  if (!request) {
    return { title: "Request not found" };
  }

  return {
    title: `${request.reference} · ${request.leaveType.name} leave`,
    description: `${request.employee.name}'s ${request.leaveType.name.toLowerCase()} leave request.`,
  };
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const request = requestById(id);

  if (!request) {
    notFound();
  }

  if (!canViewRequest(session, request)) {
    redirect("/forbidden");
  }

  const events = auditForRequest(request.id);
  const canDecide = canDecideRequest(session, request);
  const manager = request.employee.managerId ? employeeFor(request.employee.managerId) : null;
  const balance = balancesFor(request.employee.id).find(
    (entry) => entry.leaveType.id === request.leaveType.id,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Request ${request.reference}`}
        title={`${request.leaveType.name} leave`}
        description={`${formatDateRange(request.startDate, request.endDate)} · ${formatDays(request.days)} · submitted ${formatDateTime(request.createdAt)}`}
        actions={
          <Button asChild variant="secondary">
            <Link href={session.role === "hr_admin" ? "/audit" : "/requests"}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Link>
          </Button>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar name={request.employee.name} size="lg" />
                <div>
                  <p className="text-h3 text-foreground">{request.employee.name}</p>
                  <p className="text-small text-muted-foreground">
                    {request.employee.jobTitle} · {request.employee.team}
                  </p>
                  <p className="text-caption text-muted-foreground">{request.employee.email}</p>
                </div>
              </div>
              <StatusBadge status={request.status} />
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-caption text-muted-foreground">Leave type</dt>
                  <dd className="mt-1">
                    <LeaveTypeBadge leaveType={request.leaveType} />
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Dates</dt>
                  <dd className="text-small text-foreground mt-1 flex items-center gap-2 font-semibold">
                    <CalendarDays aria-hidden="true" className="text-muted-foreground size-4" />
                    {formatDateRange(request.startDate, request.endDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Working days</dt>
                  <dd className="text-small text-foreground mt-1 font-semibold tabular-nums">
                    {formatDays(request.days)}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Manager</dt>
                  <dd className="text-small text-foreground mt-1 flex items-center gap-2 font-semibold">
                    <UserRound aria-hidden="true" className="text-muted-foreground size-4" />
                    {manager?.name ?? "No manager assigned"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Submitted</dt>
                  <dd className="text-small text-foreground mt-1 font-semibold">
                    {formatDateTime(request.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Record</dt>
                  <dd className="text-caption text-foreground mt-1 font-mono">
                    {request.reference}
                  </dd>
                </div>
              </dl>

              <div>
                <h2 className="text-caption text-muted-foreground font-semibold tracking-wide uppercase">
                  Reason
                </h2>
                <p className="bg-surface-muted text-small text-foreground mt-2 rounded-md p-3">
                  {request.reason}
                </p>
              </div>

              {request.status !== "pending" ? (
                <div
                  className={
                    request.status === "approved"
                      ? "border-success/25 bg-success-subtle text-success-foreground rounded-md border p-4"
                      : "border-danger/25 bg-danger-subtle text-danger-foreground rounded-md border p-4"
                  }
                >
                  <p className="text-small font-semibold capitalize">
                    {request.status}
                    {request.decidedBy ? ` by ${request.decidedBy.name}` : ""}
                    {request.decidedAt ? ` · ${formatDateTime(request.decidedAt)}` : ""}
                  </p>
                  {request.decisionNote ? (
                    <p className="text-small mt-1 opacity-90">{request.decisionNote}</p>
                  ) : null}
                </div>
              ) : (
                <Alert variant="info" title="Awaiting a decision">
                  {manager
                    ? `${manager.name} will see this in their scoped approvals queue.`
                    : "This request needs an HR override decision."}
                </Alert>
              )}
            </CardContent>
          </Card>

          {canDecide ? (
            <section aria-label="Decision panel" className="space-y-3">
              <div>
                <h2 className="text-h3 text-foreground">Record a decision</h2>
                <p className="text-small text-muted-foreground">
                  Day 0 previews the decision dialog; persistence, balance updates, and the audit
                  row land in Day 1.
                </p>
              </div>
              <ApprovalCard request={request} />
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Audit trail</CardTitle>
              <CardDescription>Append-only records for this request.</CardDescription>
            </CardHeader>
            <CardContent>
              <AuditTrail events={events} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Balance impact</CardTitle>
              <CardDescription>What approval would change.</CardDescription>
            </CardHeader>
            <CardContent className="text-small space-y-2">
              {request.leaveType.tracksBalance ? (
                <>
                  <p className="text-foreground">
                    {request.status === "approved"
                      ? `${formatDays(request.days)} already deducted from ${request.employee.name.split(" ")[0]}'s ${request.leaveType.name} balance.`
                      : `Approving deducts ${formatDays(request.days)} from ${request.employee.name.split(" ")[0]}'s ${request.leaveType.name} balance.`}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    Confirmed balance:{" "}
                    {balance?.confirmed === null || balance?.confirmed === undefined
                      ? "—"
                      : formatDays(balance.confirmed)}
                    {balance && balance.pending > 0
                      ? ` · ${formatDays(balance.pending)} pending`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="text-foreground">
                  Unpaid leave has no balance to track, so no balance check blocks this request.
                </p>
              )}
              <p className="text-caption text-muted-foreground">
                Pending requests are never deducted before a decision.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Policy</CardTitle>
              <CardDescription>Rule applied to this request.</CardDescription>
            </CardHeader>
            <CardContent className="text-small text-muted-foreground space-y-2">
              <p>
                {request.leaveType.tracksBalance
                  ? `${request.leaveType.name} accrues automatically each month.`
                  : "Unpaid leave is independent of accrual and always available by policy."}
              </p>
              <Badge variant="neutral">{request.employee.team} team</Badge>
              <p className="text-caption flex items-start gap-2">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                Request records are retained for at least three years and cannot be hard-deleted.
              </p>
            </CardContent>
          </Card>

          <p className="text-caption text-muted-foreground">
            Last updated {formatDate(request.createdAt)}
          </p>
        </aside>
      </div>
    </div>
  );
}

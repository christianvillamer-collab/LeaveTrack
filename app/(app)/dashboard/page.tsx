import Link from "next/link";
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Inbox,
  Plus,
  ScrollText,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";

import { ApprovalCard } from "@/components/domain/approval-card";
import { AuditTrail } from "@/components/domain/audit-trail";
import { BalanceCard } from "@/components/domain/balance-card";
import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { RequestTable } from "@/components/domain/request-table";
import { StatCard } from "@/components/domain/stat-card";
import { StatusBadge } from "@/components/domain/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { viewerFor } from "@/lib/auth/access";
import { requireSession, type Session } from "@/lib/auth/session";
import {
  accrualSummary,
  allAuditEvents,
  allRequests,
  auditForEmployee,
  balancesFor,
  directReports,
  employees,
  pendingTeamRequests,
  policies,
  requestsForEmployee,
  teamRequests,
} from "@/lib/mock/data";
import type { Employee, LeaveRequest } from "@/lib/types";
import { formatDate, formatDateRange, formatDays } from "@/lib/utils/format";

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function upcomingLeave(requests: LeaveRequest[]): LeaveRequest[] {
  const today = new Date().toISOString().slice(0, 10);
  return requests
    .filter((request) => request.startDate >= today && request.status !== "rejected")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function vacationBalance(employeeId: string): string {
  const balance = balancesFor(employeeId).find((entry) => entry.leaveType.name === "Vacation");
  return balance?.confirmed === null || balance?.confirmed === undefined
    ? "—"
    : formatDays(balance.confirmed);
}

export default async function DashboardPage() {
  const session = await requireSession();
  const viewer = viewerFor(session);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${viewer.team} · ${viewer.jobTitle}`}
        title={`Welcome back, ${firstName(viewer.name)}`}
        description={
          session.role === "employee"
            ? "Your balances, upcoming leave, and recent requests in one place."
            : session.role === "manager"
              ? "Your direct reports' requests, and the decisions waiting on you."
              : "Organisation-wide leave health, accrual status, and the audit trail."
        }
        actions={
          <Button asChild>
            <Link href="/requests/new">
              <Plus aria-hidden="true" />
              Request leave
            </Link>
          </Button>
        }
      />

      {session.role === "employee" ? <EmployeeDashboard session={session} viewer={viewer} /> : null}
      {session.role === "manager" ? <ManagerDashboard viewer={viewer} /> : null}
      {session.role === "hr_admin" ? <HrDashboard /> : null}
    </div>
  );
}

function EmployeeDashboard({ session, viewer }: { session: Session; viewer: Employee }) {
  const myRequests = requestsForEmployee(viewer.id);
  const balances = balancesFor(viewer.id);
  const pending = myRequests.filter((request) => request.status === "pending");
  const upcoming = upcomingLeave(myRequests);
  const approvedDays = myRequests
    .filter((request) => request.status === "approved")
    .reduce((total, request) => total + request.days, 0);
  const nextLeave = upcoming[0];

  return (
    <>
      <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Vacation available"
          value={vacationBalance(viewer.id)}
          hint="Updated after the 1 Nov accrual"
          icon={CalendarCheck2}
        />
        <StatCard
          label="Pending requests"
          value={String(pending.length)}
          hint={pending.length > 0 ? "Awaiting manager review" : "Nothing waiting"}
          icon={Timer}
          tone="warning"
        />
        <StatCard
          label="Approved days booked"
          value={String(approvedDays)}
          hint="Across all leave types this year"
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Next leave"
          value={nextLeave ? formatDateRange(nextLeave.startDate, nextLeave.endDate) : "None"}
          hint={
            nextLeave
              ? `${nextLeave.leaveType.name} · ${formatDays(nextLeave.days)}`
              : "Book time off"
          }
          icon={CalendarDays}
          tone={nextLeave ? "info" : "neutral"}
        />
      </section>

      <section aria-label="Your balances" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {balances.map((balance) => (
          <BalanceCard key={balance.leaveType.id} balance={balance} />
        ))}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Recent requests</CardTitle>
              <CardDescription>Your last submissions and their decisions.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/requests">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <RequestTable requests={myRequests.slice(0, 4)} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming leave</CardTitle>
              <CardDescription>Approved and pending time away.</CardDescription>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="Nothing scheduled"
                  description="Your next approved or pending leave will show up here."
                  className="px-4 py-8"
                />
              ) : (
                <ul className="space-y-3">
                  {upcoming.slice(0, 3).map((request) => (
                    <li key={request.id} className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-small text-foreground font-semibold">
                          {formatDateRange(request.startDate, request.endDate)}
                        </p>
                        <div className="flex items-center gap-2">
                          <LeaveTypeBadge leaveType={request.leaveType} />
                          <span className="text-caption text-muted-foreground">
                            {formatDays(request.days)}
                          </span>
                        </div>
                      </div>
                      <StatusBadge status={request.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Decision history</CardTitle>
              <CardDescription>Audit rows tied to your requests.</CardDescription>
            </CardHeader>
            <CardContent>
              <AuditTrail events={auditForEmployee(viewer.id).slice(0, 3)} />
            </CardContent>
          </Card>
        </div>
      </div>

      {session.role === "employee" && pending.length > 0 ? (
        <Alert variant="info" title="Pending requests do not reduce your confirmed balance">
          Your manager&apos;s decision will move the amount from pending into your confirmed total.
        </Alert>
      ) : null}
    </>
  );
}

function ManagerDashboard({ viewer }: { viewer: Employee }) {
  const pending = pendingTeamRequests(viewer.id);
  const team = teamRequests(viewer.id);
  const reports = directReports(viewer.id);
  const decided = team.filter((request) => request.status !== "pending");
  const currentlyAway = team.filter((request) => request.status === "approved").slice(0, 3);

  return (
    <>
      <section aria-label="Team at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Awaiting your decision"
          value={String(pending.length)}
          hint="Direct reports only"
          icon={Inbox}
          tone="warning"
        />
        <StatCard
          label="Direct reports"
          value={String(reports.length)}
          hint="Your approval scope"
          icon={Users}
          tone="info"
        />
        <StatCard
          label="Team requests"
          value={String(team.length)}
          hint="In the current mock window"
          icon={ClipboardList}
        />
        <StatCard
          label="Vacation available to you"
          value={vacationBalance(viewer.id)}
          hint="Your own balance"
          icon={CalendarCheck2}
          tone="success"
        />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-h3 text-foreground">Pending approvals</h2>
              <p className="text-small text-muted-foreground">
                Only requests from people who report to you.
              </p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/approvals">Open queue</Link>
            </Button>
          </div>

          {pending.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Your queue is clear"
              description="New requests from your direct reports will appear here."
            />
          ) : (
            <div className="space-y-4">
              {pending.slice(0, 2).map((request) => (
                <ApprovalCard key={request.id} request={request} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your queue scope</CardTitle>
              <CardDescription>How approvals are scoped.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert variant="info">
                The queue filters on <code className="text-caption font-mono">manager_id</code> in
                the query itself, so another team&apos;s requests never reach your screen.
              </Alert>
              <ul className="text-small text-muted-foreground space-y-2">
                {reports.map((report) => (
                  <li key={report.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{report.name}</span>
                    <Badge variant="neutral">{report.team}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent team decisions</CardTitle>
              <CardDescription>Approved and rejected requests.</CardDescription>
            </CardHeader>
            <CardContent>
              {decided.length === 0 ? (
                <p className="text-small text-muted-foreground">No decisions recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {decided.slice(0, 3).map((request) => (
                    <li key={request.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/requests/${request.id}`}
                          className="text-small text-foreground hover:text-primary truncate font-semibold"
                        >
                          {request.employee.name}
                        </Link>
                        <StatusBadge status={request.status} />
                      </div>
                      <p className="text-caption text-muted-foreground">
                        {request.leaveType.name} ·{" "}
                        {formatDateRange(request.startDate, request.endDate)} ·{" "}
                        {formatDays(request.days)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approved time away</CardTitle>
              <CardDescription>Latest approved requests from your team.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {currentlyAway.map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-3">
                    <span className="text-small text-foreground truncate">
                      {request.employee.name}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {formatDateRange(request.startDate, request.endDate)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function HrDashboard() {
  const requests = allRequests();
  const pending = requests.filter((request) => request.status === "pending");
  const events = allAuditEvents();

  return (
    <>
      <section
        aria-label="Organisation at a glance"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="Pending across the org"
          value={String(pending.length)}
          hint="Includes every team"
          icon={Inbox}
          tone="warning"
        />
        <StatCard
          label="People covered"
          value={accrualSummary.employeesProcessed.toLocaleString("en-GB")}
          hint="Demo workspace shows 10 people"
          icon={Users}
          tone="info"
        />
        <StatCard
          label="Audit events"
          value={String(events.length)}
          hint="Mock records in this workspace"
          icon={ScrollText}
        />
        <StatCard
          label="Last accrual"
          value={formatDate(accrualSummary.lastRunAt)}
          hint={`Next run ${formatDate(accrualSummary.nextRunAt)}`}
          icon={CalendarCheck2}
          tone="success"
        />
      </section>

      <Alert variant="info" title="Retention is a schema guarantee, not a UI setting">
        Leave requests are soft-deleted only. No hard-delete path exists for requests or audit rows,
        and the audit report reads the retained history.
      </Alert>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Policy snapshot</CardTitle>
              <CardDescription>Accrual rules configured for the organisation.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings/policies">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Leave type</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead className="text-right">Accrual / month</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <LeaveTypeBadge leaveType={policy.leaveType} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {policy.leaveType.tracksBalance ? "Tracked" : "Not tracked"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {policy.leaveType.tracksBalance ? `${policy.accrualPerMonth} days` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Recent audit events</CardTitle>
              <CardDescription>Latest decisions and submissions.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/audit">Open audit log</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <AuditTrail events={events.slice(0, 4)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Requests needing a decision</CardTitle>
            <CardDescription>HR override view across all teams.</CardDescription>
          </div>
          <Badge variant="warning">{pending.length} pending</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <RequestTable requests={pending.slice(0, 5)} showEmployee />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace composition</CardTitle>
          <CardDescription>Mock employees used to exercise role scoping.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Employee</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Manager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell className="text-foreground font-medium">{employee.name}</TableCell>
                  <TableCell>
                    <Badge variant={employee.role === "hr_admin" ? "primary" : "neutral"}>
                      {employee.role === "hr_admin"
                        ? "HR Admin"
                        : employee.role === "manager"
                          ? "Manager"
                          : "Employee"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{employee.team}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {employee.managerId
                      ? (employees.find((person) => person.id === employee.managerId)?.name ??
                        "Unknown")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="text-caption text-muted-foreground flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-4" />
        Access is scoped server-side for every role. Mock data is used across this workspace.
      </div>
    </>
  );
}

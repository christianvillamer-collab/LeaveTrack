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
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireSession, type Session } from "@/lib/auth/session";
import {
  countAuditEvents,
  listAuditEventsForEmployee,
  listRecentAuditEvents,
} from "@/lib/db/audit";
import { getAccrualSummary } from "@/lib/db/accrual";
import {
  getBalancesForUser,
  getMyLeaveData,
  getTeamLeaveData,
  listScopedLeaveRequests,
} from "@/lib/db/leave";
import { listPolicyOverview } from "@/lib/db/policies";
import { listDirectory } from "@/lib/db/users";
import {
  summariseEmployeeLeave,
  summariseManagerQueue,
  summariseOrg,
  todayIso,
} from "@/lib/domain/dashboard";
import type {
  AccrualSummary,
  AuditEvent,
  DirectoryEntry,
  LeaveBalance,
  MyLeaveData,
  OrgLeaveOverview,
  PolicyOverview,
  TeamLeaveData,
} from "@/lib/types";
import { formatDate, formatDateRange, formatDays } from "@/lib/utils/format";

export const metadata = { title: "Dashboard" };

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function balanceValue(balance: LeaveBalance | null): string {
  return balance?.confirmed === null || balance?.confirmed === undefined
    ? "—"
    : formatDays(balance.confirmed);
}

interface EmployeeViewData {
  data: MyLeaveData;
  events: AuditEvent[];
}

interface ManagerViewData {
  team: TeamLeaveData;
  balances: LeaveBalance[];
}

interface HrViewData {
  overview: OrgLeaveOverview;
  directory: DirectoryEntry[];
  events: AuditEvent[];
  eventCount: number;
  policies: PolicyOverview[];
  accrual: AccrualSummary;
}

export default async function DashboardPage() {
  const session = await requireSession();

  let databaseUnavailable = false;
  let employeeData: EmployeeViewData | null = null;
  let managerData: ManagerViewData | null = null;
  let hrData: HrViewData | null = null;

  try {
    if (session.role === "employee") {
      const [data, events] = await Promise.all([
        getMyLeaveData(session.id),
        listAuditEventsForEmployee(session.id, 3),
      ]);

      employeeData = { data, events };
    } else if (session.role === "manager") {
      const [team, balances] = await Promise.all([
        getTeamLeaveData(session.id),
        getBalancesForUser(session.id),
      ]);

      managerData = { team, balances };
    } else if (session.role === "hr_admin") {
      // HR reads the org-wide list, which the scoped SQL only returns for the
      // `hr_admin` role. No post-query filtering is used to widen access, and
      // an unrecognized role loads nothing.
      const [requests, directory, events, eventCount, policies, accrual] = await Promise.all([
        listScopedLeaveRequests({ id: session.id, role: session.role }),
        listDirectory(),
        listRecentAuditEvents(4),
        countAuditEvents(),
        listPolicyOverview(),
        getAccrualSummary(),
      ]);

      hrData = {
        overview: { requests, headcount: directory.length },
        directory,
        events,
        eventCount,
        policies,
        accrual,
      };
    }
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          session.role === "employee"
            ? "My workspace"
            : session.role === "manager"
              ? "Manager workspace"
              : ROLE_LABELS[session.role]
        }
        title={`Welcome back, ${firstName(session.name)}`}
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

      {databaseUnavailable ? (
        <Alert variant="warning" title="Database not configured">
          <div className="space-y-2">
            <p>
              The dashboard reads balances, requests, and audit rows from Postgres. Set{" "}
              <code className="font-mono">DATABASE_URL</code> in{" "}
              <code className="font-mono">.env.local</code>, then run:
            </p>
            <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
          </div>
        </Alert>
      ) : session.role === "employee" && employeeData ? (
        <EmployeeDashboard session={session} {...employeeData} />
      ) : session.role === "manager" && managerData ? (
        <ManagerDashboard {...managerData} />
      ) : session.role === "hr_admin" && hrData ? (
        <HrDashboard data={hrData} />
      ) : null}
    </div>
  );
}

function EmployeeDashboard({
  session,
  data,
  events,
}: {
  session: Session;
  data: MyLeaveData;
  events: AuditEvent[];
}) {
  const summary = summariseEmployeeLeave({ id: session.id, name: session.name }, data, todayIso());
  const vacation = summary.vacationBalance;
  const nextLeave = summary.nextLeave;

  return (
    <>
      <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Vacation available"
          value={balanceValue(vacation)}
          hint={
            vacation?.lastAccruedAt
              ? `Last accrued ${formatDate(vacation.lastAccruedAt.slice(0, 10))}`
              : "No accrual has run yet"
          }
          icon={CalendarCheck2}
        />
        <StatCard
          label="Pending requests"
          value={String(summary.pendingCount)}
          hint={summary.pendingCount > 0 ? "Awaiting manager review" : "Nothing waiting"}
          icon={Timer}
          tone="warning"
        />
        <StatCard
          label="Approved days booked"
          value={String(summary.approvedDays)}
          hint="Across all leave types"
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

      <section aria-label="Your balances">
        {data.balances.length === 0 ? (
          <EmptyState
            icon={CalendarCheck2}
            title="No balances configured"
            description="Ask HR to assign a leave policy before requesting leave."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.balances.map((balance) => (
              <BalanceCard key={balance.leaveType.id} balance={balance} />
            ))}
          </div>
        )}
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
            <RequestTable
              requests={summary.requests.slice(0, 4)}
              emptyTitle="No requests yet"
              emptyDescription="Your first leave request will appear here with its decision status."
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming leave</CardTitle>
              <CardDescription>Approved and pending time away.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="Nothing scheduled"
                  description="Your next approved or pending leave will show up here."
                  className="px-4 py-8"
                />
              ) : (
                <ul className="space-y-3">
                  {summary.upcoming.slice(0, 3).map((request) => (
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
              <AuditTrail events={events} />
            </CardContent>
          </Card>
        </div>
      </div>

      {summary.pendingCount > 0 ? (
        <Alert variant="info" title="Pending requests do not reduce your confirmed balance">
          Your manager&apos;s decision will move the amount from pending into your confirmed total.
        </Alert>
      ) : null}
    </>
  );
}

function ManagerDashboard({ team, balances }: ManagerViewData) {
  const queue = summariseManagerQueue(team);
  const vacation = balances.find((balance) => balance.leaveType.name === "Vacation") ?? null;

  return (
    <>
      <section aria-label="Team at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Awaiting your decision"
          value={String(queue.pendingCount)}
          hint="Direct reports only"
          icon={Inbox}
          tone="warning"
        />
        <StatCard
          label="Direct reports"
          value={String(queue.reports.length)}
          hint="Your approval scope"
          icon={Users}
          tone="info"
        />
        <StatCard
          label="Team requests"
          value={String(team.requests.length)}
          hint="Every status, newest first"
          icon={ClipboardList}
        />
        <StatCard
          label="Vacation available to you"
          value={balanceValue(vacation)}
          hint="Your own balance"
          icon={CalendarCheck2}
          tone="success"
        />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Pending approvals</CardTitle>
              <CardDescription>Only requests from people who report to you.</CardDescription>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/approvals">Open queue</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <RequestTable
              requests={queue.pending.slice(0, 2)}
              showEmployee
              emptyTitle="Your queue is clear"
              emptyDescription="New requests from your direct reports will appear here."
            />
          </CardContent>
        </Card>

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
              {queue.reports.length === 0 ? (
                <p className="text-small text-muted-foreground">
                  No one reports to you right now. Your queue stays empty until a manager assignment
                  changes.
                </p>
              ) : (
                <ul className="text-small text-muted-foreground space-y-2">
                  {queue.reports.map((report) => (
                    <li key={report.id} className="flex items-center justify-between gap-3">
                      <span className="text-foreground truncate">{report.name}</span>
                      <span className="text-caption text-muted-foreground truncate">
                        {report.email}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent team decisions</CardTitle>
              <CardDescription>Approved and rejected requests.</CardDescription>
            </CardHeader>
            <CardContent>
              {queue.decided.length === 0 ? (
                <p className="text-small text-muted-foreground">No decisions recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {queue.decided.slice(0, 3).map((request) => (
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
              {queue.currentlyAway.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="No approved leave yet"
                  description="Approved team leave will be listed here."
                  className="px-4 py-8"
                />
              ) : (
                <ul className="space-y-3">
                  {queue.currentlyAway.map((request) => (
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
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function HrDashboard({ data }: { data: HrViewData }) {
  const org = summariseOrg(data);
  const { accrual } = org;

  return (
    <>
      <section
        aria-label="Organisation at a glance"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="Pending across the org"
          value={String(org.pendingCount)}
          hint="Includes every team"
          icon={Inbox}
          tone="warning"
        />
        <StatCard
          label="People covered"
          value={accrual.peopleProcessed.toLocaleString("en-GB")}
          hint={
            accrual.lastPeriod
              ? `Accrued for ${formatDate(accrual.lastPeriod)}`
              : "No accrual has run yet"
          }
          icon={Users}
          tone="info"
        />
        <StatCard
          label="Audit events"
          value={org.eventCount.toLocaleString("en-GB")}
          hint="Append-only rows"
          icon={ScrollText}
        />
        <StatCard
          label="Last accrual"
          value={accrual.lastRunAt ? formatDate(accrual.lastRunAt.slice(0, 10)) : "—"}
          hint={
            accrual.nextRunAt
              ? `Next run ${formatDate(accrual.nextRunAt)}`
              : "No accrual has run yet"
          }
          icon={CalendarCheck2}
          tone={accrual.lastRunAt ? "success" : "neutral"}
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
            {org.policies.length === 0 ? (
              <EmptyState
                icon={CalendarCheck2}
                title="No leave types configured"
                description="A leave type must exist before accrual can be configured."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Leave type</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead className="text-right">Accrual / month</TableHead>
                    <TableHead className="text-right">People</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {org.policies.map((policy) => (
                    <TableRow key={policy.leaveType.id}>
                      <TableCell>
                        <LeaveTypeBadge leaveType={policy.leaveType} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {policy.leaveType.tracksBalance ? "Tracked" : "Not tracked"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {policy.leaveType.tracksBalance
                          ? `${policy.accrualPerMonth.toLocaleString("en-GB")} days`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {policy.assignedEmployees}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
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
            <AuditTrail events={org.events} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Requests needing a decision</CardTitle>
            <CardDescription>HR override view across all teams.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="warning">{org.pendingCount} pending</Badge>
            <Button asChild variant="ghost" size="sm">
              <Link href="/approvals">Open override queue</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <RequestTable
            requests={org.pending.slice(0, 5)}
            showEmployee
            emptyTitle="No pending requests"
            emptyDescription="Every request across the organisation has a decision."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace composition</CardTitle>
          <CardDescription>
            {org.headcount.toLocaleString("en-GB")} {org.headcount === 1 ? "account" : "accounts"}{" "}
            with their manager assignment.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.directory.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No accounts yet"
              description="Seed the workspace or invite employees to populate this table."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Manager</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.directory.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <p className="text-foreground font-medium">{entry.name}</p>
                      <p className="text-caption text-muted-foreground truncate">{entry.email}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.role === "hr_admin" ? "primary" : "neutral"}>
                        {ROLE_LABELS[entry.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.managerName ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="text-caption text-muted-foreground flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-4" />
        Every number on this page is read from Postgres and scoped by the signed-in user&apos;s
        role.
      </div>
    </>
  );
}

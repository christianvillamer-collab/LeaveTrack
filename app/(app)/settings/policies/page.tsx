import { CalendarCheck2, History, LockKeyhole, ShieldCheck, Users } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { PolicyRateForm } from "@/components/domain/policy-rate-form";
import { Alert } from "@/components/ui/alert";
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
import { canConfigurePolicies } from "@/lib/auth/policy";
import { requirePolicy } from "@/lib/auth/session";
import { getAccrualSummary } from "@/lib/db/accrual";
import { listLeaveTypes } from "@/lib/db/leave";
import { listPolicyChangeLog, listPolicyOverview } from "@/lib/db/policies";
import { listDirectory } from "@/lib/db/users";
import type {
  AccrualSummary,
  DirectoryEntry,
  LeaveType,
  PolicyChange,
  PolicyOverview,
} from "@/lib/types";
import { formatDate, formatDateTime, formatDays } from "@/lib/utils/format";

export const metadata = { title: "Leave policies" };

export default async function PoliciesPage() {
  await requirePolicy(canConfigurePolicies);

  let databaseUnavailable = false;
  let directory: DirectoryEntry[] = [];
  let leaveTypes: LeaveType[] = [];
  let overview: PolicyOverview[] = [];
  let changes: PolicyChange[] = [];
  let accrual: AccrualSummary = {
    lastPeriod: null,
    lastRunAt: null,
    nextRunAt: null,
    peopleProcessed: 0,
  };

  try {
    [directory, leaveTypes, overview, changes, accrual] = await Promise.all([
      listDirectory(),
      listLeaveTypes(),
      listPolicyOverview(),
      listPolicyChangeLog(10),
      getAccrualSummary(),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  const trackedTypes = leaveTypes.filter((type) => type.tracksBalance);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Leave policies"
        description="Effective-dated accrual rates per employee. A change starts with its effective month; past periods and balances are never rewritten."
      />

      {databaseUnavailable ? (
        <Alert variant="warning" title="Database not configured">
          <div className="space-y-2">
            <p>
              Policy administration needs Postgres. Set{" "}
              <code className="font-mono">DATABASE_URL</code> in{" "}
              <code className="font-mono">.env.local</code>, then run:
            </p>
            <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
          </div>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Set or correct a rate</CardTitle>
              <CardDescription>
                Choose the effective month. The monthly accrual job uses the latest rate whose
                effective month is on or before the run month.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {directory.length === 0 || trackedTypes.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No employees or leave types to configure"
                  description="Run npm run db:seed to load the demo employees and tracked leave types."
                />
              ) : (
                <PolicyRateForm employees={directory} leaveTypes={leaveTypes} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current rates</CardTitle>
              <CardDescription>
                The rate in effect today, grouped by leave type. Future-dated changes appear once
                their month arrives.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Leave type</TableHead>
                    <TableHead>Balance tracked</TableHead>
                    <TableHead className="text-right">Accrual / month</TableHead>
                    <TableHead className="text-right">Assigned employees</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.map((policy) => (
                    <TableRow key={policy.leaveType.id}>
                      <TableCell>
                        <LeaveTypeBadge leaveType={policy.leaveType} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {policy.leaveType.tracksBalance ? "Yes" : "No — unlimited"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {policy.leaveType.tracksBalance ? formatDays(policy.accrualPerMonth) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {policy.assignedEmployees.toLocaleString("en-GB")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History aria-hidden="true" className="text-primary size-5" />
                Recent changes
              </CardTitle>
              <CardDescription>
                One append-only audit row per real policy change, with who changed it and when.
              </CardDescription>
            </CardHeader>
            <CardContent className={changes.length === 0 ? undefined : "p-0"}>
              {changes.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="No policy changes recorded yet"
                  description="Saving a new rate or correcting an existing effective month adds the first audit row."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Employee</TableHead>
                      <TableHead>Leave type</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Recorded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.map((change) => (
                      <TableRow key={change.id}>
                        <TableCell>
                          <span className="text-foreground font-medium">
                            {change.employee.name}
                          </span>
                          <span className="text-caption text-muted-foreground block">
                            {change.employee.email}
                          </span>
                        </TableCell>
                        <TableCell>
                          <LeaveTypeBadge leaveType={change.leaveType} />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatDate(change.effectiveFrom)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {change.previousRate === null
                            ? `— → ${formatDays(change.newRate)}`
                            : `${formatDays(change.previousRate)} → ${formatDays(change.newRate)}`}
                        </TableCell>
                        <TableCell>
                          <span className="text-foreground">{change.actor.name}</span>
                          <span className="text-caption text-muted-foreground block">
                            {formatDateTime(change.changedAt)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-small text-muted-foreground">
            Unpaid leave deliberately has no policy row and is never blocked by a balance check.
            Only Vacation and Sick accrue.
          </p>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck2 aria-hidden="true" className="text-primary size-5" />
                  Accrual schedule
                </CardTitle>
                <CardDescription>Monthly, automatic, and idempotent.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="text-small space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Last completed run</dt>
                    <dd className="text-foreground font-semibold">
                      {accrual.lastRunAt ? formatDate(accrual.lastRunAt.slice(0, 10)) : "Never run"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Next scheduled run</dt>
                    <dd className="text-foreground font-semibold">
                      {accrual.nextRunAt ? formatDate(accrual.nextRunAt) : "Not scheduled"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Employees processed</dt>
                    <dd className="text-foreground font-semibold tabular-nums">
                      {accrual.peopleProcessed.toLocaleString("en-GB")}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Duplicate-run guard</dt>
                    <dd className="text-foreground font-semibold">One accrual per month</dd>
                  </div>
                </dl>
                <p className="text-caption text-muted-foreground mt-4">
                  Running the job twice in the same month is a no-op. The uniqueness guard lives in
                  the accrual ledger, not in application memory.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="text-primary size-5" />
                  Guardrails
                </CardTitle>
                <CardDescription>What the schema guarantees.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-small text-muted-foreground space-y-3">
                  <li className="flex gap-2">
                    <LockKeyhole
                      aria-hidden="true"
                      className="text-primary mt-0.5 size-4 shrink-0"
                    />
                    <span>
                      Policy history is insert-only; past effective months cannot be changed through
                      the app, and the current month locks once it has accrued.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck
                      aria-hidden="true"
                      className="text-primary mt-0.5 size-4 shrink-0"
                    />
                    Policy audit rows are append-only and one row is written per real change.
                  </li>
                  <li className="flex gap-2">
                    <Users aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
                    The accrual job resolves the rate effective for the run month, never
                    today&apos;s rate.
                  </li>
                  <li className="flex gap-2">
                    <CalendarCheck2
                      aria-hidden="true"
                      className="text-primary mt-0.5 size-4 shrink-0"
                    />
                    Accrual amounts are numeric, never floating-point approximations.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

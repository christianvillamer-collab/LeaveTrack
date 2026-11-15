import { CalendarCheck2, LockKeyhole, ShieldCheck, Users } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { policies } from "@/lib/mock/data";
import type { AccrualSummary } from "@/lib/types";
import { formatDate, formatDays } from "@/lib/utils/format";

export const metadata = { title: "Leave policies" };

export default async function PoliciesPage() {
  await requirePolicy(canConfigurePolicies);

  let accrual: AccrualSummary = {
    lastPeriod: null,
    lastRunAt: null,
    nextRunAt: null,
    peopleProcessed: 0,
  };
  let accrualUnavailable = false;

  try {
    accrual = await getAccrualSummary();
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      accrualUnavailable = true;
    } else {
      throw error;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Leave policies"
        description="Accrual rules assigned to employees. Policy editing is intentionally read-only in the Day 0 scaffold."
      />

      <Alert variant="info" title="Read-only in Day 0">
        These values drive the monthly accrual job in Day 1. Changing a policy will always create an
        audit record; no silent edits.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Configured policies</CardTitle>
          <CardDescription>One policy row per employee and leave type.</CardDescription>
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
              {policies.map((policy) => (
                <TableRow key={policy.id}>
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

      <p className="text-small text-muted-foreground">
        Unpaid leave deliberately has no policy row and is never blocked by a balance check. Only
        Vacation and Sick accrue.
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
                  {accrual.lastRunAt
                    ? formatDate(accrual.lastRunAt.slice(0, 10))
                    : accrualUnavailable
                      ? "Unavailable"
                      : "Never run"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Next scheduled run</dt>
                <dd className="text-foreground font-semibold">
                  {accrual.nextRunAt
                    ? formatDate(accrual.nextRunAt)
                    : accrualUnavailable
                      ? "Unavailable"
                      : "Not scheduled"}
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
              Running the job twice in the same month is a no-op. The uniqueness guard lives in the
              accrual ledger, not in application memory.
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
                <LockKeyhole aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
                <span>
                  Leave requests are soft-deleted only; <code className="font-mono">DELETE</code> is
                  blocked by the schema.
                </span>
              </li>
              <li className="flex gap-2">
                <ShieldCheck aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
                Audit rows are append-only and never exposed to update or delete routes.
              </li>
              <li className="flex gap-2">
                <Users aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
                Manager scope is a query predicate, not a client-side filter.
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
    </div>
  );
}

import Link from "next/link";
import { ArrowLeft, CalendarDays, CheckCircle2, Info, Wallet } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { RequestForm } from "@/components/domain/request-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { getBalancesForUser, listLeaveTypes } from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";
import type { LeaveBalance, LeaveType } from "@/lib/types";
import { formatDate, formatDays } from "@/lib/utils/format";

export const metadata = { title: "Request leave" };

const DEMO_EMAILS = [
  "maya.chen@leavetrack.demo",
  "daniel.okafor@leavetrack.demo",
  "priya.nair@leavetrack.demo",
];

export default async function NewRequestPage() {
  const session = await requireSession();

  let databaseUnavailable = false;
  let user: Awaited<ReturnType<typeof findUserByEmail>> = null;
  let leaveTypes: LeaveType[] = [];
  let balances: LeaveBalance[] = [];

  try {
    user = await findUserByEmail(session.email);

    if (user) {
      [leaveTypes, balances] = await Promise.all([listLeaveTypes(), getBalancesForUser(user.id)]);
    }
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  const ready = Boolean(user) && leaveTypes.length > 0;
  const balanceSummary = balances.map((balance) => ({
    leaveTypeId: balance.leaveType.id,
    available: balance.confirmed,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="New request"
        title="Request leave"
        description="Pick a leave type, choose inclusive dates, and add context for your manager."
        actions={
          <Button asChild variant="secondary">
            <Link href="/requests">
              <ArrowLeft aria-hidden="true" />
              Back to requests
            </Link>
          </Button>
        }
      />

      {!ready ? (
        <Alert
          variant="warning"
          title={
            databaseUnavailable
              ? "Database not configured"
              : user
                ? "No leave types configured"
                : "No employee record for this account"
          }
        >
          {databaseUnavailable ? (
            <div className="space-y-2">
              <p>
                Request submission needs Postgres. Set{" "}
                <code className="font-mono">DATABASE_URL</code> in{" "}
                <code className="font-mono">.env.local</code>, then run:
              </p>
              <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
            </div>
          ) : user ? (
            <div className="space-y-2">
              <p>
                The leave_types table is empty. Run the seed to create Vacation, Sick, and Unpaid.
              </p>
              <p className="text-caption font-mono">npm run db:seed</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p>
                The mock login accepts any email, but submission requires a seeded DB account. Sign
                out from the sidebar and sign in with one of these demo emails:
              </p>
              <ul className="text-caption list-inside list-disc font-mono">
                {DEMO_EMAILS.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </div>
          )}
        </Alert>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>Request details</CardTitle>
              <CardDescription>All fields are required except where noted.</CardDescription>
            </CardHeader>
            <CardContent>
              <RequestForm
                leaveTypes={leaveTypes}
                defaultLeaveTypeId={leaveTypes[0]?.id}
                balanceSummary={balanceSummary}
              />
            </CardContent>
          </Card>

          <aside className="space-y-6" aria-label="Balance context">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet aria-hidden="true" className="text-primary size-5" />
                  Balance snapshot
                </CardTitle>
                <CardDescription>As of the last completed accrual.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {balances.map((balance) => (
                  <div
                    key={balance.leaveType.id}
                    className="border-border flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <LeaveTypeBadge leaveType={balance.leaveType} />
                    <div className="text-right">
                      <p className="text-small text-foreground font-semibold tabular-nums">
                        {balance.confirmed === null ? "No limit" : formatDays(balance.confirmed)}
                      </p>
                      {balance.pending > 0 ? (
                        <p className="text-caption text-warning-foreground">
                          {formatDays(balance.pending)} pending
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
                <p className="text-caption text-muted-foreground">
                  Updated {formatDate(balances[0]?.lastAccruedAt ?? new Date().toISOString())}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 aria-hidden="true" className="text-primary size-5" />
                  Before you submit
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-small text-muted-foreground space-y-3">
                  <li className="flex gap-2">
                    <CalendarDays
                      aria-hidden="true"
                      className="text-primary mt-0.5 size-4 shrink-0"
                    />
                    Dates are inclusive: 16–20 Nov counts as five days.
                  </li>
                  <li className="flex gap-2">
                    <Info aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
                    Exceeding your balance warns you, but still lets you submit for HR override.
                  </li>
                  <li className="flex gap-2">
                    <Wallet aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
                    Unpaid leave is never blocked by a balance check.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Alert variant="info" title="Pending, not deducted">
              Submitting creates a pending request and an audit record. Your confirmed balance
              changes only after a manager approves it.
            </Alert>
          </aside>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { CalendarCheck2, CalendarPlus, Wallet } from "lucide-react";

import { BalanceCard } from "@/components/domain/balance-card";
import { PendingRequestTable } from "@/components/domain/pending-request-table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { getMyLeaveData } from "@/lib/db/leave";
import type { MyLeaveData } from "@/lib/types";
import { formatDate, formatDays } from "@/lib/utils/format";

export const metadata = { title: "My balance" };

export default async function BalancePage() {
  const session = await requireSession();

  let databaseUnavailable = false;
  let data: MyLeaveData = { balances: [], requests: [] };

  try {
    data = await getMyLeaveData(session.id);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  const { balances, requests } = data;
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const trackedBalances = balances.filter((balance) => balance.leaveType.tracksBalance);
  const lastAccruedAt = trackedBalances.reduce<string | null>(
    (latest, balance) =>
      balance.lastAccruedAt && (!latest || balance.lastAccruedAt > latest)
        ? balance.lastAccruedAt
        : latest,
    null,
  );
  const totalConfirmed = balances.reduce((total, balance) => total + (balance.confirmed ?? 0), 0);
  const ready = balances.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Time off"
        title="My balance"
        description="Confirmed balance, pending amounts, and your accrual policy."
        actions={
          <Button asChild>
            <Link href="/requests/new">
              <CalendarPlus aria-hidden="true" />
              Request leave
            </Link>
          </Button>
        }
      />

      {!ready ? (
        <Alert
          variant="warning"
          title={databaseUnavailable ? "Database not configured" : "No balances configured"}
        >
          {databaseUnavailable ? (
            <div className="space-y-2">
              <p>
                Balance data needs Postgres. Set <code className="font-mono">DATABASE_URL</code> in{" "}
                <code className="font-mono">.env.local</code>, then run:
              </p>
              <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p>
                No leave types or balances are configured for this account. Run the seed and check
                the employee&apos;s leave policies.
              </p>
              <p className="text-caption font-mono">npm run db:seed</p>
            </div>
          )}
        </Alert>
      ) : (
        <>
          <section
            aria-label="Balances by leave type"
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {balances.map((balance) => (
              <BalanceCard key={balance.leaveType.id} balance={balance} />
            ))}
          </section>

          <Alert variant="info" title="Pending amounts are held separately">
            A pending request is visible but not deducted. Approving it moves the amount out of your
            confirmed balance and creates an audit record; rejecting it changes nothing.
          </Alert>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card>
              <CardHeader>
                <CardTitle>Pending requests holding balance</CardTitle>
                <CardDescription>These amounts are not yet deducted.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <PendingRequestTable requests={pendingRequests} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck2 aria-hidden="true" className="text-primary size-5" />
                  Accrual policy
                </CardTitle>
                <CardDescription>Assigned by HR; no self-service changes.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="text-small space-y-3">
                  {balances.map((balance) => (
                    <div
                      key={balance.leaveType.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <dt className="text-muted-foreground">{balance.leaveType.name}</dt>
                      <dd className="text-foreground font-semibold">
                        {balance.accrualPerMonth === null
                          ? "No balance"
                          : `${formatDays(balance.accrualPerMonth)} / month`}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="bg-surface-muted text-caption text-secondary mt-4 flex items-center gap-2 rounded-md px-3 py-2">
                  <Wallet aria-hidden="true" className="size-4 shrink-0" />
                  {formatDays(totalConfirmed)} across tracked types
                </div>
                <p className="text-caption text-muted-foreground mt-3">
                  {lastAccruedAt
                    ? `Last accrual ${formatDate(lastAccruedAt)}. Approvals may have changed confirmed balances since.`
                    : "No accrual has run yet. Monthly accrual updates balances after a completed run."}
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

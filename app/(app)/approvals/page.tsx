import Link from "next/link";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Inbox, ShieldCheck, Timer, Users } from "lucide-react";

import { StatCard } from "@/components/domain/stat-card";
import { TeamRequestTable } from "@/components/domain/team-request-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { canManageRequests } from "@/lib/auth/policy";
import { requirePolicy } from "@/lib/auth/session";
import { getTeamLeaveData } from "@/lib/db/leave";
import type { TeamLeaveData } from "@/lib/types";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const session = await requirePolicy(canManageRequests);

  let databaseUnavailable = false;
  let data: TeamLeaveData = { requests: [], directReports: [] };

  try {
    if (session.role === "manager") {
      data = await getTeamLeaveData(session.id);
    }
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  const isManager = session.role === "manager";
  const isHr = session.role === "hr_admin";
  const pending = data.requests.filter((request) => request.status === "pending");
  const decided = data.requests.filter((request) => request.status !== "pending");
  const reports = data.directReports;
  const oldestWaiting =
    pending.length === 0
      ? 0
      : Math.max(
          ...pending.map((request) =>
            differenceInCalendarDays(new Date(), parseISO(request.createdAt)),
          ),
        );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isHr ? "HR Admin" : "Manager workspace"}
        title="Approvals"
        description={
          isHr
            ? "HR override is outside TASK-013; manager queues are scoped by manager_id."
            : "Requests from your direct reports, and nobody else."
        }
      />

      {!isManager || databaseUnavailable ? (
        <Alert
          variant="warning"
          title={
            databaseUnavailable
              ? "Database not configured"
              : isHr
                ? "HR override is not part of TASK-013"
                : "Manager access required"
          }
        >
          {databaseUnavailable ? (
            <div className="space-y-2">
              <p>
                The approvals queue needs Postgres. Set{" "}
                <code className="font-mono">DATABASE_URL</code> in{" "}
                <code className="font-mono">.env.local</code>, then run:
              </p>
              <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
            </div>
          ) : isHr ? (
            <p>
              This task covers manager queues only. Use the{" "}
              <Link href="/audit" className="font-semibold underline underline-offset-4">
                audit log
              </Link>{" "}
              for HR oversight until a separate override view is scoped.
            </p>
          ) : (
            <p>
              The signed-in account is not a manager. Approvals are scoped to employees whose
              database manager is the current user.
            </p>
          )}
        </Alert>
      ) : (
        <>
          <section
            aria-label="Approval queue summary"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard
              label="Pending requests"
              value={String(pending.length)}
              hint="Direct reports only"
              icon={Inbox}
              tone="warning"
            />
            <StatCard
              label="Oldest waiting"
              value={pending.length === 0 ? "—" : `${oldestWaiting}d`}
              hint="Calendar days since submission"
              icon={Timer}
              tone={oldestWaiting > 3 ? "danger" : "info"}
            />
            <StatCard
              label="Direct reports"
              value={String(reports.length)}
              hint="Manager-filtered query"
              icon={Users}
            />
            <StatCard
              label="Recently decided"
              value={String(decided.length)}
              hint="Approved and rejected"
              icon={ShieldCheck}
              tone="success"
            />
          </section>

          <Alert variant="info" title="Every decision is audited">
            Approving deducts the request’s days from the employee’s balance; rejecting requires a
            reason and leaves the balance unchanged. Both actions write an audit row.
          </Alert>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section aria-label="Pending approvals" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-h3 text-foreground">Awaiting a decision</h2>
                <Badge variant="warning">{pending.length} pending</Badge>
              </div>

              <TeamRequestTable
                requests={pending}
                emptyTitle="Queue is clear"
                emptyDescription="New requests from your direct reports will appear here."
                actionable
                variant="cards"
              />
            </section>

            <aside className="space-y-6" aria-label="Queue scope">
              <Card>
                <CardHeader>
                  <CardTitle>Who appears in this queue</CardTitle>
                  <CardDescription>Only employees whose manager_id matches you.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Alert variant="info">
                    The filter belongs in the query:{" "}
                    <code className="text-caption font-mono">
                      WHERE manager_id = :current_user_id
                    </code>
                    . Never filter the full list in the browser.
                  </Alert>
                  <ul className="text-small space-y-2">
                    {reports.map((report) => (
                      <li
                        key={report.id}
                        className="border-border flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                      >
                        <span className="text-foreground truncate">{report.name}</span>
                        <span className="text-muted-foreground text-caption truncate">
                          {report.email}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </aside>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Decision history</CardTitle>
              <CardDescription>
                Approved and rejected requests from your direct reports, newest first.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <TeamRequestTable
                requests={decided}
                emptyTitle="No decisions yet"
                emptyDescription="Decisions will appear here once TASK-014 records them."
              />
            </CardContent>
          </Card>

          <p className="text-caption text-muted-foreground">
            Scope: {reports.length} direct reports. Other teams are excluded by the SQL manager_id
            predicate.
          </p>
        </>
      )}
    </div>
  );
}

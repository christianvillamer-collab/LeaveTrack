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
import {
  canManageRequests,
  canOverrideRequest,
  canOverrideRequests,
  canViewTeam,
} from "@/lib/auth/policy";
import { requirePolicy } from "@/lib/auth/session";
import { getTeamLeaveData, listOrgLeaveRequests } from "@/lib/db/leave";
import type { TeamLeaveData, TeamLeaveRequest } from "@/lib/types";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const session = await requirePolicy(canManageRequests);
  const isManager = canViewTeam(session);
  const isHr = canOverrideRequests(session);

  let databaseUnavailable = false;
  let managerData: TeamLeaveData = { requests: [], directReports: [] };
  let orgRequests: TeamLeaveRequest[] = [];

  try {
    if (isManager) {
      managerData = await getTeamLeaveData(session.id);
    } else if (isHr) {
      orgRequests = await listOrgLeaveRequests();
    }
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  const requests = isManager ? managerData.requests : orgRequests;
  const pending = requests.filter((request) => request.status === "pending");
  const decided = requests.filter((request) => request.status !== "pending");
  // The queue and `/requests/[id]` must agree: HR can never act on their own
  // request. The server enforces the same predicate transactionally.
  const canActOn = (request: TeamLeaveRequest) =>
    isHr
      ? canOverrideRequest(
          { id: session.id, role: session.role },
          { ownerId: request.employee.id, ownerManagerId: null, status: request.status },
        )
      : true;
  const reports = managerData.directReports;
  const employeesWithRequests = new Set(requests.map((request) => request.employee.id)).size;
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
            ? "Review and override any employee's request. Every override needs a reason and writes an audit row."
            : "Requests from your direct reports, and nobody else."
        }
      />

      {!isManager && !isHr ? (
        <Alert variant="warning" title="Approvals access required">
          <p>
            The signed-in account is not a manager or HR admin. Approvals are scoped to employees
            whose database manager is the current user.
          </p>
        </Alert>
      ) : databaseUnavailable ? (
        <Alert variant="warning" title="Database not configured">
          <div className="space-y-2">
            <p>
              The approvals queue needs Postgres. Set{" "}
              <code className="font-mono">DATABASE_URL</code> in{" "}
              <code className="font-mono">.env.local</code>, then run:
            </p>
            <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
          </div>
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
              hint={isHr ? "Across all teams" : "Direct reports only"}
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
              label={isHr ? "Employees with requests" : "Direct reports"}
              value={String(isHr ? employeesWithRequests : reports.length)}
              hint={isHr ? "Org-wide query" : "Manager-filtered query"}
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

          <Alert
            variant="info"
            title={isHr ? "Every override is audited" : "Every decision is audited"}
          >
            {isHr
              ? "Overrides bypass the direct-manager chain. Approving deducts the request's days from the employee's balance; both decisions require a reason and write an audit row with your name."
              : "Approving deducts the request’s days from the employee’s balance; rejecting requires a reason and leaves the balance unchanged. Both actions write an audit row."}
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
                emptyDescription={
                  isHr
                    ? "New requests from any employee will appear here."
                    : "New requests from your direct reports will appear here."
                }
                actionable
                override={isHr}
                canActOn={canActOn}
                variant="cards"
              />
            </section>

            <aside className="space-y-6" aria-label="Queue scope">
              {isHr ? (
                <Card>
                  <CardHeader>
                    <CardTitle>HR override scope</CardTitle>
                    <CardDescription>
                      Every team, without widening the manager queue.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Alert variant="info">
                      Manager decisions still run through{" "}
                      <code className="text-caption font-mono">
                        WHERE manager_id = :current_user_id
                      </code>
                      . This page uses a separate org-wide query; it never filters the manager list
                      in the browser.
                    </Alert>
                    <ul className="text-small space-y-2">
                      <li>
                        <Link
                          href="/requests"
                          className="font-semibold underline underline-offset-4"
                        >
                          Browse every request
                        </Link>
                      </li>
                      <li>
                        <Link href="/audit" className="font-semibold underline underline-offset-4">
                          Review the audit log
                        </Link>
                      </li>
                    </ul>
                  </CardContent>
                </Card>
              ) : (
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
              )}
            </aside>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Decision history</CardTitle>
              <CardDescription>
                {isHr
                  ? "Approved and rejected requests across the org, newest first."
                  : "Approved and rejected requests from your direct reports, newest first."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <TeamRequestTable
                requests={decided}
                emptyTitle="No decisions yet"
                emptyDescription="Decisions will appear here once they are recorded."
              />
            </CardContent>
          </Card>

          <p className="text-caption text-muted-foreground">
            {isHr
              ? `Scope: ${employeesWithRequests} employees with requests. Manager queues keep the SQL manager_id predicate.`
              : `Scope: ${reports.length} direct reports. Other teams are excluded by the SQL manager_id predicate.`}
          </p>
        </>
      )}
    </div>
  );
}

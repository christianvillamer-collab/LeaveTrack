import Link from "next/link";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Inbox, ShieldCheck, Timer, Users } from "lucide-react";

import { StatCard } from "@/components/domain/stat-card";
import { TeamRequestTable } from "@/components/domain/team-request-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  canManageRequests,
  canOverrideRequest,
  canOverrideRequests,
  canViewTeam,
} from "@/lib/auth/policy";
import { requirePolicy } from "@/lib/auth/session";
import { listOrgLeaveRequestsPage, listTeamLeaveRequestsPage } from "@/lib/db/leave";
import { listDirectReports } from "@/lib/db/users";
import type { PaginationMeta, TeamLeaveRequest, TeamMember } from "@/lib/types";
import {
  DEFAULT_PAGE_SIZE,
  listQuerySchema,
  toPaginationMeta,
  type SearchParamValue,
} from "@/lib/validation/list";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: SearchParamValue;
    page?: SearchParamValue;
    pageSize?: SearchParamValue;
  }>;
}) {
  const session = await requirePolicy(canManageRequests);
  const isManager = canViewTeam(session);
  const isHr = canOverrideRequests(session);
  const params = await searchParams;
  const rawStatus = typeof params.status === "string" ? params.status : "";

  const parsed = listQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : null;
  const validationMessage = parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "Enter valid list filters.");

  let databaseUnavailable = false;
  let result: { items: TeamLeaveRequest[]; pagination: PaginationMeta } | null = null;
  let reports: TeamMember[] = [];

  if (query) {
    try {
      if (isManager) {
        [result, reports] = await Promise.all([
          listTeamLeaveRequestsPage(session.id, {
            status: query.status,
            page: query.page,
            pageSize: query.pageSize,
          }),
          listDirectReports(session.id),
        ]);
      } else if (isHr) {
        result = await listOrgLeaveRequestsPage({
          status: query.status,
          page: query.page,
          pageSize: query.pageSize,
        });
      }
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
        databaseUnavailable = true;
      } else {
        throw error;
      }
    }
  }

  const requests = result?.items ?? [];
  const pagination =
    result?.pagination ?? toPaginationMeta(0, query?.page ?? 1, query?.pageSize ?? 25);
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
  const employeesWithRequests = new Set(requests.map((request) => request.employee.id)).size;
  const oldestWaiting =
    pending.length === 0
      ? 0
      : Math.max(
          ...pending.map((request) =>
            differenceInCalendarDays(new Date(), parseISO(request.createdAt)),
          ),
        );

  function pageHref(page: number): string {
    const next = new URLSearchParams();
    if (query?.status) next.set("status", query.status);
    if (page !== 1) next.set("page", String(page));
    if (query && query.pageSize !== DEFAULT_PAGE_SIZE) {
      next.set("pageSize", String(query.pageSize));
    }
    const suffix = next.toString();
    return suffix ? `/approvals?${suffix}` : "/approvals";
  }

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
      ) : validationMessage ? (
        <Alert variant="danger" title="Invalid list filters">
          {validationMessage} Correct the filters and run the queue again. No results were loaded.
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
          <Card>
            <CardHeader>
              <CardTitle>Filter queue</CardTitle>
              <CardDescription>Status filtering and paging run in Postgres.</CardDescription>
            </CardHeader>
            <CardContent>
              <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5 sm:max-w-xs sm:flex-1">
                  <label htmlFor="approval-status" className="text-caption text-muted-foreground">
                    Status
                  </label>
                  <Select
                    id="approval-status"
                    name="status"
                    defaultValue={rawStatus}
                    key={rawStatus}
                  >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </Select>
                </div>
                <Button type="submit" size="sm">
                  Apply filter
                </Button>
              </form>
            </CardContent>
          </Card>

          <section
            aria-label="Approval queue summary for this page"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard
              label="Pending on page"
              value={String(pending.length)}
              hint="From the current filtered page"
              icon={Inbox}
              tone="warning"
            />
            <StatCard
              label="Oldest waiting"
              value={pending.length === 0 ? "—" : `${oldestWaiting}d`}
              hint="Calendar days since submission (this page)"
              icon={Timer}
              tone={oldestWaiting > 3 ? "danger" : "info"}
            />
            <StatCard
              label={isHr ? "Employees on page" : "Direct reports"}
              value={String(isHr ? employeesWithRequests : reports.length)}
              hint={isHr ? "From the current filtered page" : "Manager-filtered query"}
              icon={Users}
            />
            <StatCard
              label="Decided on page"
              value={String(decided.length)}
              hint="Approved and rejected on this page"
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
                <Badge variant="warning">{pending.length} pending on page</Badge>
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
                pagination={pending.length > 0 || decided.length === 0 ? pagination : undefined}
                pageHref={pending.length > 0 || decided.length === 0 ? pageHref : undefined}
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
                pagination={pending.length === 0 && decided.length > 0 ? pagination : undefined}
                pageHref={pending.length === 0 && decided.length > 0 ? pageHref : undefined}
              />
            </CardContent>
          </Card>

          <p className="text-caption text-muted-foreground">
            {isHr
              ? `Scope: ${employeesWithRequests} employees with requests on this page. Manager queues keep the SQL manager_id predicate.`
              : `Scope: ${reports.length} direct reports. Other teams are excluded by the SQL manager_id predicate.`}
          </p>
        </>
      )}
    </div>
  );
}

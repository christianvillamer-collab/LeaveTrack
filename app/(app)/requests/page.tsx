import Link from "next/link";
import { CalendarPlus, FileText } from "lucide-react";

import { RequestTable } from "@/components/domain/request-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { canRunAudit, canViewTeam } from "@/lib/auth/policy";
import { requireSession } from "@/lib/auth/session";
import { listScopedLeaveRequestsPage } from "@/lib/db/leave";
import type { PaginationMeta, RequestSummary } from "@/lib/types";
import { leaveRequestListQuerySchema } from "@/lib/validation/leave";
import { DEFAULT_PAGE_SIZE, toPaginationMeta, type SearchParamValue } from "@/lib/validation/list";

export const metadata = { title: "Requests" };

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: SearchParamValue;
    page?: SearchParamValue;
    pageSize?: SearchParamValue;
  }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const rawStatus = typeof params.status === "string" ? params.status : "";

  // Invalid list input never becomes an unbounded query. Keep the form value
  // for correction, but suppress the results entirely.
  const parsed = leaveRequestListQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : null;
  const validationMessage = parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "Enter valid list filters.");

  let databaseUnavailable = false;
  let requests: RequestSummary[] = [];
  let pagination: PaginationMeta = toPaginationMeta(0, query?.page ?? 1, query?.pageSize ?? 25);

  if (query) {
    try {
      const result = await listScopedLeaveRequestsPage(
        { id: session.id, role: session.role },
        { status: query.status, page: query.page, pageSize: query.pageSize },
      );
      requests = result.items;
      pagination = result.pagination;
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
        databaseUnavailable = true;
      } else {
        throw error;
      }
    }
  }

  const isEmployee = session.role === "employee";
  const showEmployee = canViewTeam(session) || canRunAudit(session);
  // Aggregate counts are page-scoped: pagination runs in Postgres, so a 25-row
  // page cannot describe the whole filtered result set.
  const counts = {
    pending: requests.filter((request) => request.status === "pending").length,
    approved: requests.filter((request) => request.status === "approved").length,
    rejected: requests.filter((request) => request.status === "rejected").length,
  };

  function pageHref(page: number): string {
    const next = new URLSearchParams();
    if (query?.status) next.set("status", query.status);
    if (page !== 1) next.set("page", String(page));
    if (query && query.pageSize !== DEFAULT_PAGE_SIZE) {
      next.set("pageSize", String(query.pageSize));
    }
    const suffix = next.toString();
    return suffix ? `/requests?${suffix}` : "/requests";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          isEmployee
            ? "My workspace"
            : session.role === "manager"
              ? "Manager workspace"
              : "HR Admin"
        }
        title={isEmployee ? "My requests" : "Requests"}
        description={
          isEmployee
            ? "Every request you have submitted, with the current decision status and audit trail."
            : session.role === "manager"
              ? "Your own requests plus requests from your direct reports."
              : "Every request across the organisation, newest first."
        }
        actions={
          <Button asChild>
            <Link href="/requests/new">
              <CalendarPlus aria-hidden="true" />
              Request leave
            </Link>
          </Button>
        }
      />

      {validationMessage ? (
        <Alert variant="danger" title="Invalid list filters">
          {validationMessage} Correct the filters and run the list again. No results were loaded.
        </Alert>
      ) : databaseUnavailable ? (
        <Alert variant="warning" title="Database not configured">
          <div className="space-y-2">
            <p>
              Request history needs Postgres. Set <code className="font-mono">DATABASE_URL</code> in{" "}
              <code className="font-mono">.env.local</code>, then run:
            </p>
            <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
          </div>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Filter requests</CardTitle>
              <CardDescription>Status filtering and paging run in Postgres.</CardDescription>
            </CardHeader>
            <CardContent>
              <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5 sm:max-w-xs sm:flex-1">
                  <label htmlFor="request-status" className="text-caption text-muted-foreground">
                    Status
                  </label>
                  <Select
                    id="request-status"
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

          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Request status summary for this page"
          >
            <Badge variant="neutral">{pagination.total} total</Badge>
            <Badge variant="warning">{counts.pending} pending on page</Badge>
            <Badge variant="success">{counts.approved} approved on page</Badge>
            <Badge variant="danger">{counts.rejected} rejected on page</Badge>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>{isEmployee ? "Request history" : "Scoped requests"}</CardTitle>
                <CardDescription>
                  Newest submissions first. Select a row for the full record.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/balance">Check balance</Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {requests.length === 0 && pagination.total === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={FileText}
                    title="No requests yet"
                    description={
                      isEmployee
                        ? "Submit your first leave request and it will appear here."
                        : "Requests from your scope will appear here."
                    }
                    action={
                      <Button asChild size="sm">
                        <Link href="/requests/new">Request leave</Link>
                      </Button>
                    }
                  />
                </div>
              ) : (
                <RequestTable
                  requests={requests}
                  showEmployee={showEmployee}
                  pagination={pagination}
                  pageHref={pageHref}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

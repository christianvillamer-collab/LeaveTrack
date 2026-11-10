import Link from "next/link";
import { CalendarPlus, FileText } from "lucide-react";

import { RequestTable } from "@/components/domain/request-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { canRunAudit, canViewTeam } from "@/lib/auth/policy";
import { requireSession } from "@/lib/auth/session";
import { listScopedLeaveRequests } from "@/lib/db/leave";
import type { RequestSummary } from "@/lib/types";

export const metadata = { title: "Requests" };

export default async function RequestsPage() {
  const session = await requireSession();

  let databaseUnavailable = false;
  let requests: RequestSummary[] = [];

  try {
    requests = await listScopedLeaveRequests({ id: session.id, role: session.role });
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  const isEmployee = session.role === "employee";
  const showEmployee = canViewTeam(session) || canRunAudit(session);
  const counts = {
    pending: requests.filter((request) => request.status === "pending").length,
    approved: requests.filter((request) => request.status === "approved").length,
    rejected: requests.filter((request) => request.status === "rejected").length,
  };

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

      {databaseUnavailable ? (
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
          <div className="flex flex-wrap items-center gap-2" aria-label="Request status summary">
            <Badge variant="neutral">{requests.length} total</Badge>
            <Badge variant="warning">{counts.pending} pending</Badge>
            <Badge variant="success">{counts.approved} approved</Badge>
            <Badge variant="danger">{counts.rejected} rejected</Badge>
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
              {requests.length === 0 ? (
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
                <RequestTable requests={requests} showEmployee={showEmployee} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { CalendarPlus, FileText } from "lucide-react";

import { RequestTable } from "@/components/domain/request-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { viewerFor } from "@/lib/auth/access";
import { requireSession } from "@/lib/auth/session";
import { requestsForEmployee } from "@/lib/mock/data";

export const metadata = { title: "My requests" };

export default async function RequestsPage() {
  const session = await requireSession();
  const viewer = viewerFor(session);
  const requests = requestsForEmployee(viewer.id);
  const counts = {
    pending: requests.filter((request) => request.status === "pending").length,
    approved: requests.filter((request) => request.status === "approved").length,
    rejected: requests.filter((request) => request.status === "rejected").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My workspace"
        title="My requests"
        description="Every request you have submitted, with the current decision status and audit trail."
        actions={
          <Button asChild>
            <Link href="/requests/new">
              <CalendarPlus aria-hidden="true" />
              Request leave
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2" aria-label="Request status summary">
        <Badge variant="neutral">{requests.length} total</Badge>
        <Badge variant="warning">{counts.pending} pending</Badge>
        <Badge variant="success">{counts.approved} approved</Badge>
        <Badge variant="danger">{counts.rejected} rejected</Badge>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Request history</CardTitle>
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
                description="Submit your first leave request and it will appear here."
                action={
                  <Button asChild size="sm">
                    <Link href="/requests/new">Request leave</Link>
                  </Button>
                }
              />
            </div>
          ) : (
            <RequestTable requests={requests} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

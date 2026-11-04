import { CalendarCheck2, ScrollText, ShieldCheck, Users } from "lucide-react";

import { AuditExplorer } from "@/components/domain/audit-explorer";
import { StatCard } from "@/components/domain/stat-card";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/session";
import { accrualSummary, allAuditEvents } from "@/lib/mock/data";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireRole(["hr_admin"]);
  const events = allAuditEvents();
  const employeesWithRecords = new Set(events.map((event) => event.employee.id)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance"
        title="Audit log"
        description="Every submission and decision, who recorded it, and exactly when. Retained for three years."
      />

      <section aria-label="Audit summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Audit events"
          value={String(events.length)}
          hint="Submissions and decisions"
          icon={ScrollText}
        />
        <StatCard
          label="Employees with records"
          value={String(employeesWithRecords)}
          hint="Mock workspace"
          icon={Users}
          tone="info"
        />
        <StatCard
          label="Retention"
          value="3 years"
          hint="Minimum, per BR-04"
          icon={ShieldCheck}
          tone="success"
        />
        <StatCard
          label="Last accrual"
          value={formatDate(accrualSummary.lastRunAt)}
          hint={`Next ${formatDate(accrualSummary.nextRunAt)}`}
          icon={CalendarCheck2}
          tone="neutral"
        />
      </section>

      <Alert variant="info" title="Soft delete only">
        Active views exclude <code className="text-caption font-mono">is_deleted = true</code> rows,
        but no hard-delete path exists for requests or audit records. Reports can always be produced
        for the retention window.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Decision history</CardTitle>
          <CardDescription>
            Search by employee, request reference, actor, or decision detail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditExplorer events={events} />
        </CardContent>
      </Card>
    </div>
  );
}

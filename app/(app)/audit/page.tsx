import { CalendarCheck2, ScrollText, ShieldCheck, Timer } from "lucide-react";

import { AuditExplorer } from "@/components/domain/audit-explorer";
import { StatCard } from "@/components/domain/stat-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { canRunAudit } from "@/lib/auth/policy";
import { requirePolicy } from "@/lib/auth/session";
import { getAuditReport } from "@/lib/db/audit";
import { getAccrualSummary } from "@/lib/db/accrual";
import { listEmployees, type EmployeeDirectoryEntry } from "@/lib/db/users";
import type { AccrualSummary, AuditReport, PaginationMeta } from "@/lib/types";
import { formatDate } from "@/lib/utils/format";
import { resolveAuditReportQuery } from "@/lib/validation/audit";
import { toPaginationMeta, type SearchParamValue } from "@/lib/validation/list";

export const metadata = { title: "Audit log" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    employee?: SearchParamValue;
    from?: SearchParamValue;
    to?: SearchParamValue;
    status?: SearchParamValue;
    page?: SearchParamValue;
    pageSize?: SearchParamValue;
    exportAll?: SearchParamValue;
  }>;
}) {
  await requirePolicy(canRunAudit);

  const params = await searchParams;
  const requestedEmployee = params.employee;
  const requestedFrom = params.from;
  const requestedTo = params.to;
  const requestedStatus = params.status;

  const resolved = resolveAuditReportQuery(params);
  // Invalid input produces no query at all, so it can never broaden the report.
  const query = resolved.valid ? resolved.query : null;
  const validationMessage = resolved.valid ? null : resolved.error;

  // Keep the raw submissions on failure so the form stays usable for correction.
  const raw = (value: SearchParamValue) => (typeof value === "string" ? value : "");
  const fromDefault = query ? (query.from ?? "") : raw(requestedFrom);
  const toDefault = query ? (query.to ?? "") : raw(requestedTo);
  const statusDefault = query ? (query.status ?? "") : raw(requestedStatus);
  const reportFrom = query?.from;
  const reportTo = query?.to;
  const reportStatus = query?.status;

  let databaseUnavailable = false;
  let employees: EmployeeDirectoryEntry[] = [];
  let report: AuditReport | null = null;
  let selectedEmployeeId: string | undefined;
  let pagination: PaginationMeta = toPaginationMeta(0, query?.page ?? 1, query?.pageSize ?? 25);
  let accrual: AccrualSummary = {
    lastPeriod: null,
    lastRunAt: null,
    nextRunAt: null,
    peopleProcessed: 0,
  };

  try {
    employees = await listEmployees();

    selectedEmployeeId =
      query?.employee && employees.some((employee) => employee.id === query.employee)
        ? query.employee
        : employees[0]?.id;

    if (query && selectedEmployeeId) {
      const nextReport = await getAuditReport(selectedEmployeeId, {
        from: query.from,
        to: query.to,
        status: query.status,
        page: query.page,
        pageSize: query.pageSize,
        exportAll: false,
      });
      if (nextReport) {
        report = nextReport;
        pagination = nextReport.pagination;
      }
    }

    accrual = await getAccrualSummary();
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  const employeeDefault = query ? (selectedEmployeeId ?? "") : raw(requestedEmployee);

  const requests = report?.requests ?? [];
  const pending = requests.filter((request) => request.status === "pending");
  const decided = requests.filter((request) => request.status !== "pending");
  const events = report?.events ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance"
        title="Audit log"
        description="Every submission and decision for one employee, who recorded it, and exactly when. Retained for three years."
      />

      {databaseUnavailable ? (
        <Alert variant="warning" title="Database not configured">
          <div className="space-y-2">
            <p>
              The audit report needs Postgres. Set <code className="font-mono">DATABASE_URL</code>{" "}
              in <code className="font-mono">.env.local</code>, then run:
            </p>
            <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
          </div>
        </Alert>
      ) : employees.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No employees to report on"
          description="Run npm run db:seed to load the demo employees and their audit history."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Employee report</CardTitle>
              <CardDescription>
                Soft-deleted requests are excluded here but never purged from the database.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5 sm:max-w-sm sm:flex-1">
                  <label htmlFor="audit-employee" className="text-caption text-muted-foreground">
                    Employee
                  </label>
                  <Select
                    id="audit-employee"
                    name="employee"
                    defaultValue={employeeDefault}
                    key={employeeDefault}
                  >
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} · {employee.email}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="audit-from" className="text-caption text-muted-foreground">
                    From
                  </label>
                  <Input
                    id="audit-from"
                    name="from"
                    type="date"
                    defaultValue={fromDefault}
                    className="w-full max-w-full min-w-0 sm:w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="audit-to" className="text-caption text-muted-foreground">
                    To
                  </label>
                  <Input
                    id="audit-to"
                    name="to"
                    type="date"
                    defaultValue={toDefault}
                    className="w-full max-w-full min-w-0 sm:w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="audit-status" className="text-caption text-muted-foreground">
                    Status
                  </label>
                  <Select
                    id="audit-status"
                    name="status"
                    defaultValue={statusDefault}
                    key={statusDefault}
                    className="w-full max-w-full min-w-0 sm:w-40"
                  >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </Select>
                </div>
                <Button type="submit" size="sm">
                  View report
                </Button>
              </form>

              {validationMessage ? (
                <Alert variant="danger" title="Invalid report filters" className="mt-4">
                  {validationMessage} Correct the filters above, then run the report again. No
                  report was generated.
                </Alert>
              ) : report ? (
                <p className="text-small text-muted-foreground mt-4">
                  Showing{" "}
                  <span className="text-foreground font-medium">{report.employee.name}</span> (
                  {report.employee.email}) · {report.employee.role.replace("_", " ")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {validationMessage ? null : (
            <>
              <section
                aria-label="Audit summary"
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              >
                <StatCard
                  label="Requests"
                  value={String(requests.length)}
                  hint="Excludes soft-deleted rows"
                  icon={ScrollText}
                />
                <StatCard
                  label="Decisions"
                  value={String(decided.length)}
                  hint="Approved and rejected"
                  icon={ShieldCheck}
                  tone="success"
                />
                <StatCard
                  label="Pending"
                  value={String(pending.length)}
                  hint="Awaiting a manager"
                  icon={Timer}
                  tone={pending.length > 0 ? "warning" : "neutral"}
                />
                <StatCard
                  label="Last accrual"
                  value={accrual.lastRunAt ? formatDate(accrual.lastRunAt.slice(0, 10)) : "—"}
                  hint={
                    accrual.nextRunAt
                      ? `Next ${formatDate(accrual.nextRunAt)}`
                      : "No accrual has run yet"
                  }
                  icon={CalendarCheck2}
                  tone={accrual.lastRunAt ? "success" : "neutral"}
                />
              </section>

              <Alert variant="info" title="Soft delete only">
                Active views exclude{" "}
                <code className="text-caption font-mono">is_deleted = true</code> rows, but no
                hard-delete path exists for requests or audit records. Reports can always be
                produced for the retention window.
              </Alert>

              <Card>
                <CardHeader>
                  <CardTitle>Decision history</CardTitle>
                  <CardDescription>
                    Search by request reference, actor, or decision detail.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AuditExplorer
                    key={`${selectedEmployeeId ?? ""}:${reportFrom ?? ""}:${reportTo ?? ""}:${reportStatus ?? ""}:${pagination.page}`}
                    events={events}
                    employeeId={selectedEmployeeId ?? ""}
                    from={reportFrom}
                    to={reportTo}
                    status={reportStatus}
                    pagination={pagination}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Search, ShieldCheck } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuditEvent, PaginationMeta, RequestStatus } from "@/lib/types";
import { AUDIT_CSV_HEADERS, actionLabel, auditEventToCsvRow } from "@/lib/utils/audit";
import { toCsv } from "@/lib/utils/csv";
import { formatDateTime } from "@/lib/utils/format";

type ActionFilter = "all" | AuditEvent["action"];

interface AuditExplorerProps {
  events: AuditEvent[];
  employeeId: string;
  from?: string;
  to?: string;
  status?: RequestStatus;
  pagination: PaginationMeta;
}

function csvFileName(from?: string, to?: string): string {
  const range = from || to ? `_${from ?? "start"}_${to ?? "end"}` : "";
  return `audit-report${range}.csv`;
}

function pageHref(
  page: number,
  employeeId: string,
  from: string | undefined,
  to: string | undefined,
  status: RequestStatus | undefined,
): string {
  const params = new URLSearchParams();
  if (employeeId) params.set("employee", employeeId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (status) params.set("status", status);
  params.set("page", String(page));
  return `/audit?${params.toString()}`;
}

function exportHref(
  employeeId: string,
  from: string | undefined,
  to: string | undefined,
  status: RequestStatus | undefined,
): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (status) params.set("status", status);
  params.set("exportAll", "1");
  return `/api/audit/${encodeURIComponent(employeeId)}?${params.toString()}`;
}

function matchesFilters(event: AuditEvent, needle: string, action: ActionFilter): boolean {
  const matchesAction = action === "all" || event.action === action;
  const matchesQuery =
    needle.length === 0 ||
    [
      event.employee.name,
      event.employee.email,
      event.actor.name,
      event.requestReference,
      event.detail,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  return matchesAction && matchesQuery;
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.requestReference === "string" &&
    typeof event.occurredAt === "string" &&
    typeof event.detail === "string" &&
    typeof event.action === "string" &&
    !!event.employee &&
    !!event.actor
  );
}

function isExportPayload(
  payload: unknown,
): payload is { success: true; data: { events: AuditEvent[] } } {
  if (!payload || typeof payload !== "object") return false;
  const envelope = payload as Record<string, unknown>;
  if (envelope.success !== true || !envelope.data || typeof envelope.data !== "object") {
    return false;
  }
  const data = envelope.data as Record<string, unknown>;
  return Array.isArray(data.events) && data.events.every(isAuditEvent);
}

function errorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  if (!envelope.error || typeof envelope.error !== "object") return null;
  const error = envelope.error as Record<string, unknown>;
  return typeof error.message === "string" ? error.message : null;
}

export function AuditExplorer({
  events,
  employeeId,
  from,
  to,
  status,
  pagination,
}: AuditExplorerProps) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<ActionFilter>("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => matchesFilters(event, needle, action));
  }, [action, events, query]);

  async function downloadCsv() {
    setExporting(true);
    setExportError(null);

    try {
      const response = await fetch(exportHref(employeeId, from, to, status), {
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok || !isExportPayload(payload)) {
        setExportError(
          errorMessage(payload) ?? "The full audit export could not be loaded. Try again.",
        );
        return;
      }

      const needle = query.trim().toLowerCase();
      const exportRows = payload.data.events
        .filter((event) => matchesFilters(event, needle, action))
        .map(auditEventToCsvRow);
      const csv = toCsv(AUDIT_CSV_HEADERS, exportRows);
      // A BOM keeps non-ASCII names readable in Excel.
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = csvFileName(from, to);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Could not reach the server. Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this page"
            aria-label="Search audit events on this page"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="audit-action" className="text-caption text-muted-foreground">
            Action
          </label>
          <Select
            id="audit-action"
            value={action}
            onChange={(event) => setAction(event.target.value as ActionFilter)}
            className="h-9 w-40"
          >
            <option value="all">All actions</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="hr_override_approved">HR override approved</option>
            <option value="hr_override_rejected">HR override rejected</option>
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={downloadCsv}
            disabled={pagination.total === 0 || exporting}
          >
            <Download aria-hidden="true" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {exportError ? (
        <Alert variant="danger" title="Export failed">
          {exportError}
        </Alert>
      ) : null}

      <p className="text-caption text-muted-foreground" role="status" aria-live="polite">
        Showing {filtered.length} of {events.length} on this page · {pagination.total} total audit
        events
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No matching audit events"
          description="Adjust the search or action filter, change the page, or widen the report date range. Retention records are never purged."
        />
      ) : (
        <>
          <div className="border-border bg-surface hidden rounded-lg border xl:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Occurred</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Request</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(event.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={event.employee.name} size="sm" />
                        <span className="text-foreground font-medium">{event.employee.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-caption text-foreground font-mono">
                      {event.requestReference}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          event.action === "approved" || event.action === "hr_override_approved"
                            ? "success"
                            : event.action === "rejected" || event.action === "hr_override_rejected"
                              ? "danger"
                              : "neutral"
                        }
                        className="capitalize"
                      >
                        {actionLabel(event.action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground">{event.actor.name}</TableCell>
                    <TableCell className="text-caption text-muted-foreground max-w-xs">
                      {event.detail}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-3 xl:hidden">
            {filtered.map((event) => (
              <li
                key={event.id}
                className="border-border bg-surface rounded-lg border p-4 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-small text-foreground truncate font-semibold">
                      {event.employee.name}
                    </p>
                    <p className="text-caption text-muted-foreground font-mono">
                      {event.requestReference}
                    </p>
                  </div>
                  <Badge
                    variant={
                      event.action === "approved" || event.action === "hr_override_approved"
                        ? "success"
                        : event.action === "rejected" || event.action === "hr_override_rejected"
                          ? "danger"
                          : "neutral"
                    }
                    className="capitalize"
                  >
                    {actionLabel(event.action)}
                  </Badge>
                </div>
                <p className="text-caption text-muted-foreground mt-2">{event.detail}</p>
                <p className="text-caption text-muted-foreground mt-2">
                  {formatDateTime(event.occurredAt)} · {event.actor.name}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <nav
        aria-label="Audit event pages"
        className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-caption text-muted-foreground" role="status" aria-live="polite">
          Page {pagination.page} of {pagination.pageCount}
        </p>
        <div className="flex items-center gap-2">
          {pagination.page > 1 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={pageHref(pagination.page - 1, employeeId, from, to, status)}>
                Previous
              </Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Previous
            </Button>
          )}
          {pagination.page < pagination.pageCount ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={pageHref(pagination.page + 1, employeeId, from, to, status)}>Next</Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Next
            </Button>
          )}
        </div>
      </nav>
    </div>
  );
}

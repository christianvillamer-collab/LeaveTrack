"use client";

import { useMemo, useState } from "react";
import { Download, Search, ShieldCheck } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
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
import type { AuditEvent } from "@/lib/types";
import { AUDIT_CSV_HEADERS, actionLabel, auditEventToCsvRow } from "@/lib/utils/audit";
import { toCsv } from "@/lib/utils/csv";
import { formatDateTime } from "@/lib/utils/format";

type ActionFilter = "all" | AuditEvent["action"];

const PAGE_SIZE = 25;

interface AuditExplorerProps {
  events: AuditEvent[];
  /** Report bounds from the page, used only to name the CSV download. */
  from?: string;
  to?: string;
}

function csvFileName(from?: string, to?: string): string {
  const range = from || to ? `_${from ?? "start"}_${to ?? "end"}` : "";
  return `audit-report${range}.csv`;
}

export function AuditExplorer({ events, from, to }: AuditExplorerProps) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<ActionFilter>("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
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
    });
  }, [action, events, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const firstRow = filtered.length === 0 ? 0 : start + 1;
  const lastRow = Math.min(start + PAGE_SIZE, filtered.length);

  function downloadCsv() {
    const csv = toCsv(AUDIT_CSV_HEADERS, filtered.map(auditEventToCsvRow));
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
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search employee, request, or actor"
            aria-label="Search audit events"
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
            onChange={(event) => {
              setAction(event.target.value as ActionFilter);
              setPage(1);
            }}
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
            disabled={filtered.length === 0}
          >
            <Download aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      <p className="text-caption text-muted-foreground" role="status" aria-live="polite">
        Showing {filtered.length} of {events.length} audit events
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No matching audit events"
          description="Adjust the search or action filter, or widen the report date range. Retention records are never purged."
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
                {pageRows.map((event) => (
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
            {pageRows.map((event) => (
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

          <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-muted-foreground" role="status" aria-live="polite">
              Showing {firstRow}–{lastRow} of {filtered.length} · Page {currentPage} of {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                disabled={currentPage >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

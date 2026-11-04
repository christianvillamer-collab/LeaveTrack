"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { formatDateTime } from "@/lib/utils/format";

type ActionFilter = "all" | AuditEvent["action"];

export function AuditExplorer({ events }: { events: AuditEvent[] }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<ActionFilter>("all");

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
            placeholder="Search employee, request, or actor"
            aria-label="Search audit events"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
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
          </Select>
        </div>
      </div>

      <p className="text-caption text-muted-foreground" role="status" aria-live="polite">
        Showing {filtered.length} of {events.length} audit events
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No matching audit events"
          description="Adjust the search or action filter. Retention records are never purged."
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
                          event.action === "approved"
                            ? "success"
                            : event.action === "rejected"
                              ? "danger"
                              : "neutral"
                        }
                        className="capitalize"
                      >
                        {event.action}
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
                      event.action === "approved"
                        ? "success"
                        : event.action === "rejected"
                          ? "danger"
                          : "neutral"
                    }
                    className="capitalize"
                  >
                    {event.action}
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
    </div>
  );
}

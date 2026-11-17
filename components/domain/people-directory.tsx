"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Search, UserCheck, UserCog, UserMinus, Users } from "lucide-react";

import { PersonDialog, type PersonDialogMode } from "@/components/domain/person-form";
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
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { PersonDirectoryEntry } from "@/lib/types";
import { formatDate } from "@/lib/utils/format";

export interface PeopleDirectoryProps {
  people: PersonDirectoryEntry[];
}

type StatusFilter = "all" | "active" | "inactive";

interface OpenDialog {
  mode: PersonDialogMode;
  person: PersonDirectoryEntry;
}

export function PeopleDirectory({ people }: PeopleDirectoryProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();

    return people.filter((person) => {
      if (status === "active" && !person.isActive) {
        return false;
      }

      if (status === "inactive" && person.isActive) {
        return false;
      }

      if (!term) {
        return true;
      }

      return (
        person.name.toLowerCase().includes(term) ||
        person.email.toLowerCase().includes(term) ||
        (person.team ?? "").toLowerCase().includes(term) ||
        (person.jobTitle ?? "").toLowerCase().includes(term)
      );
    });
  }, [people, query, status]);

  const activeCount = people.filter((person) => person.isActive).length;

  function openDialog(mode: PersonDialogMode, person: PersonDirectoryEntry) {
    setDialog({ mode, person });
  }

  function handleSaved() {
    router.refresh();
  }

  const actions = (person: PersonDirectoryEntry) => (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => openDialog("profile", person)}
        aria-label={`Edit ${person.name}`}
      >
        <Pencil aria-hidden="true" />
        Edit
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => openDialog("manager", person)}
        aria-label={`Change manager for ${person.name}`}
      >
        <UserCog aria-hidden="true" />
        Manager
      </Button>
      <Button
        type="button"
        variant={person.isActive ? "secondary" : "primary"}
        size="sm"
        onClick={() => openDialog("status", person)}
        aria-label={person.isActive ? `Deactivate ${person.name}` : `Reactivate ${person.name}`}
      >
        {person.isActive ? (
          <>
            <UserMinus aria-hidden="true" />
            Deactivate
          </>
        ) : (
          <>
            <UserCheck aria-hidden="true" />
            Reactivate
          </>
        )}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="people-search"
            className="text-small text-foreground mb-1.5 block font-medium"
          >
            Search people
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              id="people-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, email, team, or job title"
              className="pl-9"
            />
          </div>
        </div>

        <div className="min-w-0 sm:w-48">
          <label
            htmlFor="people-status"
            className="text-small text-foreground mb-1.5 block font-medium"
          >
            Status
          </label>
          <Select
            id="people-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="all">All ({people.length})</option>
            <option value="active">Active ({activeCount})</option>
            <option value="inactive">Inactive ({people.length - activeCount})</option>
          </Select>
        </div>
      </div>

      <p className="text-caption text-muted-foreground">
        Showing {filtered.length.toLocaleString("en-GB")} of {people.length.toLocaleString("en-GB")}{" "}
        people. Directory email is not the sign-in identity: linked accounts sign in by provider
        subject.
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No people match this view"
          description="Clear the search or switch the status filter to see the rest of the directory."
        />
      ) : (
        <>
          <div className="hidden xl:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Team / title</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={person.name} size="sm" />
                        <div className="min-w-0">
                          <p className="text-foreground truncate font-medium">{person.name}</p>
                          <p className="text-muted-foreground text-caption truncate">
                            {person.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={person.role === "hr_admin" ? "primary" : "outline"}>
                        {ROLE_LABELS[person.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {person.team ?? "—"}
                      {person.jobTitle ? (
                        <span className="text-caption block">{person.jobTitle}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {person.managerName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={person.isActive ? "success" : "danger"}>
                        {person.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {!person.isActive && person.deactivatedAt ? (
                        <span className="text-caption text-muted-foreground mt-1 block">
                          {formatDate(person.deactivatedAt)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{actions(person)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-3 xl:hidden">
            {filtered.map((person) => (
              <li
                key={person.id}
                className="border-border bg-surface rounded-lg border p-4 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={person.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-foreground text-small truncate font-semibold">
                        {person.name}
                      </p>
                      <p className="text-muted-foreground text-caption truncate">{person.email}</p>
                    </div>
                  </div>
                  <Badge variant={person.isActive ? "success" : "danger"}>
                    {person.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="text-caption text-muted-foreground mt-3 space-y-1">
                  <p>
                    {ROLE_LABELS[person.role]}
                    {person.jobTitle ? ` · ${person.jobTitle}` : ""}
                  </p>
                  <p>Team: {person.team ?? "—"}</p>
                  <p>Manager: {person.managerName ?? "—"}</p>
                  {!person.isActive && person.deactivatedAt ? (
                    <p>Deactivated: {formatDate(person.deactivatedAt)}</p>
                  ) : null}
                </div>

                <div className="mt-3">{actions(person)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <PersonDialog
        mode={dialog?.mode ?? "profile"}
        person={dialog?.person ?? null}
        people={people}
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        onSaved={handleSaved}
      />
    </div>
  );
}

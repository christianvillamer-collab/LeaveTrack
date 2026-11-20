import { History, Upload, Users } from "lucide-react";

import { PersonCreateDialog } from "@/components/domain/person-create-dialog";
import { PeopleDirectory } from "@/components/domain/people-directory";
import { PeopleImportForm } from "@/components/domain/people-import-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { canManagePeople } from "@/lib/auth/policy";
import { requirePolicy } from "@/lib/auth/session";
import { listPeople, listPersonAudit } from "@/lib/db/people";
import type { PersonAuditEntry, PersonDirectoryEntry, UserAuditAction } from "@/lib/types";
import { formatDateTime } from "@/lib/utils/format";

export const metadata = { title: "People" };

const ACTION_LABELS: Record<UserAuditAction, string> = {
  profile_updated: "Profile updated",
  manager_reassigned: "Manager reassigned",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
  imported: "Imported",
  created: "Created",
};

const ACTION_VARIANTS: Record<
  UserAuditAction,
  "neutral" | "primary" | "success" | "warning" | "danger" | "info"
> = {
  profile_updated: "info",
  manager_reassigned: "primary",
  deactivated: "danger",
  reactivated: "success",
  imported: "neutral",
  created: "success",
};

export default async function PeoplePage() {
  await requirePolicy(canManagePeople);

  let databaseUnavailable = false;
  let people: PersonDirectoryEntry[] = [];
  let audit: PersonAuditEntry[] = [];

  try {
    // No pagination yet: the directory and the audit table both load eagerly,
    // so keep the audit window small (listPersonAudit clamps to 1-100).
    [people, audit] = await Promise.all([listPeople(), listPersonAudit(20)]);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="People"
        description="Reassign managers, keep directory details current, and deactivate accounts without deleting history. Every change is audited."
        actions={databaseUnavailable ? undefined : <PersonCreateDialog people={people} />}
      />

      {databaseUnavailable ? (
        <Alert variant="warning" title="Database not configured">
          <div className="space-y-2">
            <p>
              People administration needs Postgres. Set{" "}
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
              <CardTitle className="flex items-center gap-2">
                <Users aria-hidden="true" className="text-primary size-5" />
                Directory
              </CardTitle>
              <CardDescription>
                Active and inactive people, with reporting lines and directory fields. Deactivation
                is reversible and never removes the record.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {people.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No people records yet"
                  description="Run npm run db:seed to load the demo employees, or import a batch below."
                />
              ) : (
                <PeopleDirectory people={people} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload aria-hidden="true" className="text-primary size-5" />
                Bulk import
              </CardTitle>
              <CardDescription>
                Paste a JSON array. The batch is transactional, idempotent on email, and audited
                only for rows that actually change.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PeopleImportForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History aria-hidden="true" className="text-primary size-5" />
                Recent people changes
              </CardTitle>
              <CardDescription>
                One append-only audit row per real change, with the HR actor and the affected
                person.
              </CardDescription>
            </CardHeader>
            <CardContent className={audit.length === 0 ? undefined : "p-0"}>
              {audit.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="No people changes recorded yet"
                  description="Editing a profile, reassigning a manager, or changing account status adds the first audit row."
                />
              ) : (
                <>
                  <div className="hidden xl:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Person</TableHead>
                          <TableHead>Change</TableHead>
                          <TableHead>Detail</TableHead>
                          <TableHead>By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {audit.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="text-foreground font-medium">
                              {entry.subjectName}
                            </TableCell>
                            <TableCell>
                              <Badge variant={ACTION_VARIANTS[entry.action]}>
                                {ACTION_LABELS[entry.action]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground max-w-md">
                              {entry.detail ?? "—"}
                            </TableCell>
                            <TableCell>
                              <span className="text-foreground">{entry.actorName}</span>
                              <span className="text-caption text-muted-foreground block">
                                {formatDateTime(entry.createdAt)}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <ul className="divide-border divide-y xl:hidden">
                    {audit.map((entry) => (
                      <li key={entry.id} className="space-y-2 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-foreground text-small font-semibold">
                            {entry.subjectName}
                          </span>
                          <Badge variant={ACTION_VARIANTS[entry.action]}>
                            {ACTION_LABELS[entry.action]}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-caption">{entry.detail ?? "—"}</p>
                        <p className="text-muted-foreground text-caption">
                          {entry.actorName} · {formatDateTime(entry.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

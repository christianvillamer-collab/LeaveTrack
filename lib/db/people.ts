import "server-only";

import type { TransactionSql } from "postgres";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { Role } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import type { PersonAuditEntry, PersonDirectoryEntry, UserAuditAction } from "@/lib/types";

export interface PersonProfileInput {
  name: string;
  email: string;
  jobTitle: string | null;
  team: string | null;
}

export interface PersonMutationResult {
  id: string;
  changed: boolean;
  auditWritten: boolean;
}

export interface ManagerAssignmentResult extends PersonMutationResult {
  managerId: string | null;
}

export interface PersonStatusResult extends PersonMutationResult {
  isActive: boolean;
}

export interface PeopleImportRow {
  name: string;
  email: string;
  role?: Role;
  /**
   * Three-state on every optional field: `undefined` leaves the stored value
   * alone, `null` clears it, and a value replaces it.
   */
  managerEmail?: string | null;
  jobTitle?: string | null;
  team?: string | null;
}

export interface PeopleImportResult {
  created: number;
  updated: number;
  skipped: number;
}

interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  manager_id: string | null;
  manager_name: string | null;
  job_title: string | null;
  team: string | null;
  is_active: boolean;
  deactivated_at: Date | null;
  auth_subject: string | null;
}

interface TargetRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  manager_id: string | null;
  manager_name: string | null;
  job_title: string | null;
  team: string | null;
  is_active: boolean;
  auth_subject: string | null;
}

interface ManagerCandidateRow {
  id: string;
  name: string;
  role: Role;
  is_active: boolean;
}

interface AuditRow {
  id: string;
  action: UserAuditAction;
  detail: string | null;
  actor_name: string;
  subject_name: string;
  created_at: Date;
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function toPerson(row: PersonRow): PersonDirectoryEntry {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    managerId: row.manager_id,
    managerName: row.manager_name,
    jobTitle: row.job_title,
    team: row.team,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at ? row.deactivated_at.toISOString() : null,
    authSubjectLinked: row.auth_subject !== null,
  };
}

/**
 * Everyone in the workspace, active and inactive, for `/settings/people`.
 * Search and the status filter stay client-side: the directory has no
 * pagination yet, so a server-side filter would only add an unused, unescaped
 * `ilike` path.
 */
export async function listPeople(): Promise<PersonDirectoryEntry[]> {
  const rows = await getDb()<PersonRow[]>`
    select
      u.id,
      u.name,
      u.email,
      u.role,
      u.manager_id,
      m.name as manager_name,
      u.job_title,
      u.team,
      u.is_active,
      u.deactivated_at,
      u.auth_subject
    from users u
    left join users m on m.id = u.manager_id
    order by u.is_active desc, u.name
  `;

  return rows.map(toPerson);
}

/** Most recent people changes, joined for the HR page's audit table. */
export async function listPersonAudit(limit = 20): Promise<PersonAuditEntry[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

  const rows = await getDb()<AuditRow[]>`
    select
      ual.id,
      ual.action,
      ual.detail,
      actor.name as actor_name,
      subject.name as subject_name,
      ual.created_at
    from user_audit_log ual
    join users actor on actor.id = ual.actor_id
    join users subject on subject.id = ual.subject_id
    order by ual.created_at desc, ual.id desc
    limit ${boundedLimit}
  `;

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    detail: row.detail,
    actorName: row.actor_name,
    subjectName: row.subject_name,
    createdAt: row.created_at.toISOString(),
  }));
}

async function lockTarget(tx: TransactionSql, subjectId: string): Promise<TargetRow> {
  const [row] = await tx<TargetRow[]>`
    select
      u.id,
      u.name,
      u.email,
      u.role,
      u.manager_id,
      m.name as manager_name,
      u.job_title,
      u.team,
      u.is_active,
      u.auth_subject
    from users u
    left join users m on m.id = u.manager_id
    where u.id = ${subjectId}
    for update of u
  `;

  if (!row) {
    throw AppError.notFound("No employee record matches that account.");
  }

  return row;
}

/**
 * A manager candidate must exist, be active, and actually hold the manager
 * role. HR admins are not manager candidates: their HR override path is
 * separate, so they never become a reporting line.
 */
async function loadManagerCandidate(
  tx: TransactionSql,
  managerId: string,
): Promise<ManagerCandidateRow> {
  const [candidate] = await tx<ManagerCandidateRow[]>`
    select id, name, role, is_active
    from users
    where id = ${managerId}
    limit 1
  `;

  if (!candidate) {
    throw AppError.validation("Select an existing manager.");
  }

  if (!candidate.is_active) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      "That manager is deactivated. Reactivate them or choose another manager.",
      409,
    );
  }

  if (candidate.role !== "manager") {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      "The selected person does not have the manager role.",
      409,
    );
  }

  return candidate;
}

/**
 * Walks the proposed manager's upward chain. `union` (not `union all`) keeps a
 * pre-existing cycle from looping forever; finding the subject in the chain
 * would close a new cycle.
 */
async function assertNoManagerCycle(
  tx: TransactionSql,
  subjectId: string,
  managerId: string,
): Promise<void> {
  if (managerId === subjectId) {
    throw new AppError(ERROR_CODES.CONFLICT, "A person cannot be their own manager.", 409);
  }

  const [cycle] = await tx<{ id: string }[]>`
    with recursive chain as (
      select id, manager_id
      from users
      where id = ${managerId}
      union
      select u.id, u.manager_id
      from users u
      join chain c on u.id = c.manager_id
    )
    select id
    from chain
    where id = ${subjectId}
    limit 1
  `;

  if (cycle) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      "That assignment would create a reporting cycle.",
      409,
    );
  }
}

async function auditPeopleChange(
  tx: TransactionSql,
  actorId: string,
  subjectId: string,
  action: UserAuditAction,
  detail: string,
): Promise<void> {
  await tx`
    insert into user_audit_log (actor_id, subject_id, action, detail)
    values (${actorId}, ${subjectId}, ${action}, ${detail})
  `;
}

/**
 * Updates directory fields. A no-op save writes no audit row. The directory
 * email can be corrected on linked and unlinked rows alike: a linked row keeps
 * its identity because resolution is subject-first, and an unlinked row's
 * email is only the fallback key until the first sign-in binds the subject.
 */
export async function updatePersonProfile(
  actorId: string,
  subjectId: string,
  input: PersonProfileInput,
): Promise<PersonMutationResult> {
  try {
    return await getDb().begin(async (tx) => {
      const current = await lockTarget(tx, subjectId);

      const next = {
        name: input.name.trim(),
        email: input.email.trim(),
        jobTitle: normalizeText(input.jobTitle),
        team: normalizeText(input.team),
      };

      const changes: string[] = [];

      if (current.name !== next.name) {
        changes.push(`name: ${current.name} → ${next.name}`);
      }

      // Compare exactly: a case-only correction is still an edit HR asked for.
      if (current.email !== next.email) {
        changes.push(`email: ${current.email} → ${next.email}`);
      }

      if ((current.job_title ?? null) !== next.jobTitle) {
        changes.push(`job title: ${current.job_title ?? "none"} → ${next.jobTitle ?? "none"}`);
      }

      if ((current.team ?? null) !== next.team) {
        changes.push(`team: ${current.team ?? "none"} → ${next.team ?? "none"}`);
      }

      if (changes.length === 0) {
        return { id: subjectId, changed: false, auditWritten: false };
      }

      await tx`
        update users
        set name = ${next.name},
            email = ${next.email},
            job_title = ${next.jobTitle},
            team = ${next.team}
        where id = ${subjectId}
      `;

      await auditPeopleChange(tx, actorId, subjectId, "profile_updated", changes.join("; "));

      return { id: subjectId, changed: true, auditWritten: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, "That email address is already in use.", 409);
    }

    throw error;
  }
}

/**
 * Reassigns a reporting line under a transaction-scoped advisory lock so two
 * concurrent edits cannot each pass the cycle check. Pending requests move
 * automatically because the queues join on `users.manager_id`; no request rows
 * are rewritten.
 */
export async function reassignManager(
  actorId: string,
  subjectId: string,
  managerId: string | null,
): Promise<ManagerAssignmentResult> {
  return getDb().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('users.manager_graph'))`;

    const current = await lockTarget(tx, subjectId);

    if (current.manager_id === managerId) {
      return {
        id: subjectId,
        changed: false,
        auditWritten: false,
        managerId: current.manager_id,
      };
    }

    const candidate = managerId ? await loadManagerCandidate(tx, managerId) : null;

    if (candidate) {
      await assertNoManagerCycle(tx, subjectId, candidate.id);
    }

    await tx`
      update users
      set manager_id = ${managerId}
      where id = ${subjectId}
    `;

    await auditPeopleChange(
      tx,
      actorId,
      subjectId,
      "manager_reassigned",
      `manager: ${current.manager_name ?? "none"} → ${candidate?.name ?? "none"}`,
    );

    return {
      id: subjectId,
      changed: true,
      auditWritten: true,
      managerId,
    };
  });
}

/**
 * Deactivation is a reversible flag with three transactional guards: never
 * yourself, never the last active HR admin, and never a manager who still has
 * active direct reports. Reactivation is refused while the person's manager is
 * inactive, so nobody is restored into a queue no one can open.
 */
export async function setPersonActive(
  actorId: string,
  subjectId: string,
  isActive: boolean,
  reason?: string,
): Promise<PersonStatusResult> {
  return getDb().begin(async (tx) => {
    // Same lock as reassignment/import, taken first so the lock order matches
    // and a concurrent import cannot slip an active report under a manager
    // between the report count below and the status write.
    await tx`select pg_advisory_xact_lock(hashtext('users.manager_graph'))`;

    const target = await lockTarget(tx, subjectId);

    if (target.is_active === isActive) {
      return {
        id: subjectId,
        changed: false,
        auditWritten: false,
        isActive: target.is_active,
      };
    }

    if (!isActive) {
      if (subjectId === actorId) {
        throw AppError.forbidden("You cannot deactivate your own account.");
      }

      if (target.role === "hr_admin") {
        const [hrCount] = await tx<{ count: number }[]>`
          select count(*)::int as count
          from users
          where role = 'hr_admin'
            and is_active = true
        `;

        if (hrCount.count <= 1) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            "This is the last active HR admin. Add another HR admin before deactivating this account.",
            409,
          );
        }
      }

      const [reports] = await tx<{ count: number }[]>`
        select count(*)::int as count
        from users
        where manager_id = ${subjectId}
          and is_active = true
      `;

      if (reports.count > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${reports.count} active direct report(s) still report to this manager. Reassign them first.`,
          409,
        );
      }
    } else if (target.manager_id) {
      // Restoring a report under an inactive manager would put their requests
      // in a queue nobody can sign in to open.
      const [manager] = await tx<{ name: string; is_active: boolean }[]>`
        select name, is_active
        from users
        where id = ${target.manager_id}
        limit 1
      `;

      if (manager && !manager.is_active) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${manager.name} is inactive. Reassign this person to an active manager before reactivating them.`,
          409,
        );
      }
    }

    await tx`
      update users
      set is_active = ${isActive},
          deactivated_at = ${isActive ? null : new Date()}
      where id = ${subjectId}
    `;

    const note = normalizeText(reason);

    await auditPeopleChange(
      tx,
      actorId,
      subjectId,
      isActive ? "reactivated" : "deactivated",
      isActive ? "Reactivated" : `Deactivated${note ? `: ${note}` : ""}`,
    );

    return {
      id: subjectId,
      changed: true,
      auditWritten: true,
      isActive,
    };
  });
}

/**
 * All-or-nothing import keyed on lower(email). Identical rows are skipped
 * without an audit row. A `managerEmail` must already exist with the manager
 * role, or name a manager created earlier in the same batch (forward
 * references are rejected). Role changes on existing rows are deliberately
 * ignored.
 *
 * Optional fields are three-state: omitted leaves the stored value alone,
 * `null` clears it, and a value replaces it. New rows have no `auth_subject`;
 * the subject is bound on the first sign-in whose verified email matches the
 * row (or by `npm run auth:seed` in development), not by an HR action.
 */
export async function bulkImportPeople(
  actorId: string,
  rows: PeopleImportRow[],
): Promise<PeopleImportResult> {
  try {
    return await getDb().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('users.manager_graph'))`;

      const managerEmails = [
        ...new Set(
          rows
            .map((row) => row.managerEmail?.trim().toLowerCase())
            .filter((email): email is string => Boolean(email)),
        ),
      ];

      const managers = new Map<string, ManagerCandidateRow>();

      if (managerEmails.length > 0) {
        const managerRows = await tx<(ManagerCandidateRow & { email: string })[]>`
          select id, name, role, is_active, lower(email) as email
          from users
          where lower(email) = any(${managerEmails}::text[])
        `;

        for (const manager of managerRows) {
          managers.set(manager.email, manager);
        }
      }

      // One lookup for the whole batch instead of one round trip per row. The
      // map is also updated after each insert so a later row can resolve a
      // manager created earlier in the same batch.
      const emails = [...new Set(rows.map((row) => row.email.trim().toLowerCase()))];

      const existingByEmail = new Map<string, TargetRow>();

      if (emails.length > 0) {
        const existingRows = await tx<(TargetRow & { email_key: string })[]>`
          select
            u.id,
            u.name,
            u.email,
            u.role,
            u.manager_id,
            m.name as manager_name,
            u.job_title,
            u.team,
            u.is_active,
            u.auth_subject,
            lower(u.email) as email_key
          from users u
          left join users m on m.id = u.manager_id
          where lower(u.email) = any(${emails}::text[])
        `;

        for (const existing of existingRows) {
          existingByEmail.set(existing.email_key, existing);
        }
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const row of rows) {
        const email = row.email.trim();
        const managerProvided = row.managerEmail !== undefined;
        const managerEmail = managerProvided
          ? row.managerEmail?.trim().toLowerCase() || null
          : null;
        const manager = managerEmail ? managers.get(managerEmail) : null;

        if (managerEmail && managerEmail === email.toLowerCase()) {
          throw AppError.validation("A person cannot be their own manager.");
        }

        if (managerEmail && !manager) {
          throw AppError.validation(
            `No existing employee matches the manager email ${row.managerEmail}.`,
          );
        }

        if (manager && (!manager.is_active || manager.role !== "manager")) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            `The manager email ${row.managerEmail} does not belong to an active manager.`,
            409,
          );
        }

        const existing = existingByEmail.get(email.toLowerCase());

        const nextName = row.name.trim();
        // Omitted optional keys stay `undefined` so the update leaves them alone;
        // `null` is an explicit clear.
        const jobTitleProvided = row.jobTitle !== undefined;
        const teamProvided = row.team !== undefined;
        const nextJobTitle = jobTitleProvided ? normalizeText(row.jobTitle) : null;
        const nextTeam = teamProvided ? normalizeText(row.team) : null;
        const nextManagerId = managerProvided ? (manager?.id ?? null) : null;

        if (existing) {
          const changes: string[] = [];

          if (existing.name !== nextName) {
            changes.push(`name: ${existing.name} → ${nextName}`);
          }

          if (jobTitleProvided && (existing.job_title ?? null) !== nextJobTitle) {
            changes.push(`job title: ${existing.job_title ?? "none"} → ${nextJobTitle ?? "none"}`);
          }

          if (teamProvided && (existing.team ?? null) !== nextTeam) {
            changes.push(`team: ${existing.team ?? "none"} → ${nextTeam ?? "none"}`);
          }

          if (managerProvided && existing.manager_id !== nextManagerId) {
            if (nextManagerId) {
              await assertNoManagerCycle(tx, existing.id, nextManagerId);
            }

            changes.push(
              `manager: ${existing.manager_name ?? "none"} → ${manager?.name ?? "none"}`,
            );
          }

          if (changes.length === 0) {
            skipped += 1;
            continue;
          }

          await tx`
            update users
            set name = ${nextName},
                job_title = case when ${jobTitleProvided} then ${nextJobTitle}::text else job_title end,
                team = case when ${teamProvided} then ${nextTeam}::text else team end,
                manager_id = case when ${managerProvided} then ${nextManagerId}::uuid else manager_id end
            where id = ${existing.id}
          `;

          await auditPeopleChange(
            tx,
            actorId,
            existing.id,
            "imported",
            `Updated via import: ${changes.join("; ")}`,
          );

          updated += 1;
          continue;
        }

        const [inserted] = await tx<{ id: string }[]>`
          insert into users (name, email, role, manager_id, job_title, team)
          values (
            ${nextName},
            ${email},
            ${row.role ?? "employee"}::user_role,
            ${nextManagerId},
            ${normalizeText(row.jobTitle)},
            ${normalizeText(row.team)}
          )
          returning id
        `;

        if (!inserted) {
          throw AppError.internal("The imported employee could not be created.");
        }

        const insertedRole = row.role ?? "employee";

        existingByEmail.set(email.toLowerCase(), {
          id: inserted.id,
          name: nextName,
          email,
          role: insertedRole,
          manager_id: nextManagerId,
          manager_name: manager?.name ?? null,
          job_title: normalizeText(row.jobTitle),
          team: normalizeText(row.team),
          is_active: true,
          auth_subject: null,
        });

        // A manager created earlier in this batch is a valid target for later
        // rows, so first-rollout imports do not need two passes.
        if (insertedRole === "manager") {
          managers.set(email.toLowerCase(), {
            id: inserted.id,
            name: nextName,
            role: "manager",
            is_active: true,
          });
        }

        await auditPeopleChange(tx, actorId, inserted.id, "imported", "Created via bulk import");

        created += 1;
      }

      return { created, updated, skipped };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, "An email in the import is already in use.", 409);
    }

    throw error;
  }
}

import "server-only";

import type { Role } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import type { DirectoryEntry, TeamMember } from "@/lib/types";

export interface DbUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  jobTitle: string | null;
  team: string | null;
  isActive: boolean;
  authSubject: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  manager_id: string | null;
  job_title: string | null;
  team: string | null;
  is_active: boolean;
  auth_subject: string | null;
}

export interface EmployeeDirectoryEntry {
  id: string;
  name: string;
  email: string;
  role: Role;
}

function toDbUser(row: UserRow): DbUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    managerId: row.manager_id,
    jobTitle: row.job_title,
    team: row.team,
    isActive: row.is_active,
    authSubject: row.auth_subject,
  };
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const rows = await getDb()<UserRow[]>`
    select id, name, email, role, manager_id, job_title, team, is_active, auth_subject
    from users
    where lower(email) = lower(${email.trim()})
    limit 1
  `;

  const row = rows[0];

  return row ? toDbUser(row) : null;
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const rows = await getDb()<UserRow[]>`
    select id, name, email, role, manager_id, job_title, team, is_active, auth_subject
    from users
    where id = ${id}
    limit 1
  `;

  const row = rows[0];

  return row ? toDbUser(row) : null;
}

export interface ResolvedIdentity {
  user: DbUser;
  needsSubjectLink: boolean;
}

/**
 * Maps a verified provider identity to exactly one `users` row. The provider
 * subject is authoritative once linked; a verified email is only a fallback for
 * a row that has never been linked. A linked row never falls back to email, so
 * an HR email edit cannot silently hand the account to a different identity.
 */
export async function resolveUserForIdentity({
  subject,
  email,
}: {
  subject: string | null;
  email: string;
}): Promise<ResolvedIdentity | null> {
  if (subject) {
    const rows = await getDb()<UserRow[]>`
      select id, name, email, role, manager_id, job_title, team, is_active, auth_subject
      from users
      where auth_subject = ${subject}
      limit 1
    `;

    if (rows[0]) {
      return { user: toDbUser(rows[0]), needsSubjectLink: false };
    }
  }

  const rows = await getDb()<UserRow[]>`
    select id, name, email, role, manager_id, job_title, team, is_active, auth_subject
    from users
    where auth_subject is null
      and lower(email) = lower(${email.trim()})
    limit 1
  `;

  if (!rows[0]) {
    return null;
  }

  return {
    user: toDbUser(rows[0]),
    needsSubjectLink: subject !== null,
  };
}

/**
 * Binds a provider subject on first successful sign-in. The `auth_subject is
 * null` predicate means an existing link is never overwritten. A unique
 * collision throws; the login action and `/auth/callback` catch it, log
 * `auth.subject_link_failed`, and let the sign-in proceed (the verified email
 * already mapped to the row), so the next attempt can retry the bind.
 */
export async function linkAuthSubject(userId: string, subject: string): Promise<boolean> {
  const rows = await getDb()<{ id: string }[]>`
    update users
    set auth_subject = ${subject}
    where id = ${userId}
      and auth_subject is null
    returning id
  `;

  return rows.length > 0;
}

export async function listEmployees(): Promise<EmployeeDirectoryEntry[]> {
  // Deliberately includes deactivated people: HR still needs to open their
  // audit history after they leave. Do not filter on `is_active` here.
  return getDb()<EmployeeDirectoryEntry[]>`
    select id, name, email, role
    from users
    order by name
  `;
}

export async function listDirectReports(managerId: string): Promise<TeamMember[]> {
  return getDb()<TeamMember[]>`
    select id, name, email
    from users
    where manager_id = ${managerId}
      and is_active = true
    order by name
  `;
}

interface DirectoryRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  manager_id: string | null;
  manager_name: string | null;
}

/**
 * Everyone in the workspace with the manager name resolved in SQL. By default
 * only active people are returned, which is what the HR dashboard's
 * composition table and headcount need. Pass `includeInactive` for surfaces
 * that must still reach a leaver — the policy rate picker corrects historical
 * rates. `DirectoryEntry` deliberately omits the people-admin fields
 * (`jobTitle`, `team`, deactivation state); `/settings/people` uses
 * `listPeople` for that wider shape.
 */
export async function listDirectory({
  includeInactive = false,
}: { includeInactive?: boolean } = {}): Promise<DirectoryEntry[]> {
  const rows = await getDb()<DirectoryRow[]>`
    select
      u.id,
      u.name,
      u.email,
      u.role,
      u.manager_id,
      m.name as manager_name
    from users u
    left join users m on m.id = u.manager_id
    where (${includeInactive}::boolean or u.is_active = true)
    order by u.name
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    managerId: row.manager_id,
    managerName: row.manager_name,
  }));
}

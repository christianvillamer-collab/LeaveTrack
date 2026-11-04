import "server-only";

import type { Role } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import type { TeamMember } from "@/lib/types";

export interface DbUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  manager_id: string | null;
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const rows = await getDb()<UserRow[]>`
    select id, name, email, role, manager_id
    from users
    where lower(email) = lower(${email.trim()})
    limit 1
  `;

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    managerId: row.manager_id,
  };
}

export async function listDirectReports(managerId: string): Promise<TeamMember[]> {
  return getDb()<TeamMember[]>`
    select id, name, email
    from users
    where manager_id = ${managerId}
    order by name
  `;
}

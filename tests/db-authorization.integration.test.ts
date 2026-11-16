import { randomUUID } from "node:crypto";

import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const TABLES = [
  "users",
  "leave_types",
  "leave_policies",
  "leave_balances",
  "leave_requests",
  "audit_log",
  "accrual_ledger",
  "policy_audit_log",
] as const;

type Table = (typeof TABLES)[number];
type Privilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

// ADR-LeaveTrack-E005. `leavetrack_app` is server-only and never receives DELETE.
const EXPECTED: Record<Table, Record<Privilege, boolean>> = {
  users: { SELECT: true, INSERT: false, UPDATE: false, DELETE: false },
  leave_types: { SELECT: true, INSERT: false, UPDATE: false, DELETE: false },
  leave_policies: { SELECT: true, INSERT: true, UPDATE: true, DELETE: false },
  leave_balances: { SELECT: true, INSERT: true, UPDATE: true, DELETE: false },
  leave_requests: { SELECT: true, INSERT: true, UPDATE: true, DELETE: false },
  audit_log: { SELECT: true, INSERT: true, UPDATE: false, DELETE: false },
  accrual_ledger: { SELECT: true, INSERT: true, UPDATE: false, DELETE: false },
  policy_audit_log: { SELECT: true, INSERT: true, UPDATE: false, DELETE: false },
};

const CLIENT_ROLES = ["anon", "authenticated"] as const;

/**
 * SET ROLE needs superuser or explicit membership. Supabase's `postgres` user is
 * neither, so the behavioural probes skip there; the static assertions above are
 * role-independent and still run.
 */
async function canSetRole(sql: Sql, role: string): Promise<boolean> {
  const [row] = await sql<{ is_super: boolean; is_member: boolean }[]>`
    select coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_super,
           pg_has_role(current_user, ${role}::text, 'member') as is_member
  `;
  return row.is_super || row.is_member;
}

/**
 * The default-privilege probe creates and drops a table. Only do that on a local
 * database: `npm run test:db` loads `.env.local`, which can point at production.
 */
function isLocalDatabase(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function tablePrivilege(
  sql: Sql,
  role: string,
  table: string,
  privilege: string,
): Promise<boolean> {
  const [row] = await sql<{ allowed: boolean }[]>`
    select has_table_privilege(
      ${role}::name,
      ${`public.${table}`}::text,
      ${privilege}::text
    ) as allowed
  `;
  return row.allowed;
}

describe.skipIf(!hasDatabase)("database authorization", () => {
  let sql: Sql;

  beforeAll(() => {
    sql = getDb();
  });

  afterAll(async () => {
    await getDb().end({ timeout: 5 });
  });

  it("enables row-level security on every application table", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity
      from pg_class
      where relnamespace = 'public'::regnamespace
        and relkind = 'r'
    `;
    const byName = new Map(rows.map((row) => [row.relname, row.relrowsecurity]));

    for (const table of TABLES) {
      expect(byName.get(table), `RLS flag for ${table}`).toBe(true);
    }
  });

  it("grants leavetrack_app exactly the documented verb matrix", async () => {
    for (const table of TABLES) {
      for (const privilege of Object.keys(EXPECTED[table]) as Privilege[]) {
        const allowed = await tablePrivilege(sql, "leavetrack_app", table, privilege);
        expect(allowed, `${table} ${privilege}`).toBe(EXPECTED[table][privilege]);
      }

      // No DDL-adjacent verbs either.
      for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        expect(
          await tablePrivilege(sql, "leavetrack_app", table, privilege),
          `${table} ${privilege}`,
        ).toBe(false);
      }
    }
  });

  it("keeps anon and authenticated off every application table", async () => {
    for (const role of CLIENT_ROLES) {
      for (const table of TABLES) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"] as Privilege[]) {
          const allowed = await tablePrivilege(sql, role, table, privilege);
          expect(allowed, `${role} ${table} ${privilege}`).toBe(false);
        }
      }
    }
  });

  it("keeps anon and authenticated off schema_migrations", async () => {
    for (const role of CLIENT_ROLES) {
      const [row] = await sql<{ allowed: boolean }[]>`
        select exists (
          select 1
          from pg_class c
          where c.oid = to_regclass('public.schema_migrations')
            and has_table_privilege(${role}, c.oid, 'SELECT')
        ) as allowed
      `;
      expect(row.allowed, `${role} schema_migrations SELECT`).toBe(false);
    }
  });

  it("defines an explicit allow and an explicit restrictive deny policy per table", async () => {
    const rows = await sql<
      {
        tablename: string;
        policyname: string;
        roles: string[];
        permissive: string;
        qual: string | null;
      }[]
    >`
      select tablename, policyname, roles::text[] as roles, permissive, qual
      from pg_policies
      where schemaname = 'public'
    `;

    for (const table of TABLES) {
      const appPolicy = rows.find((row) => row.policyname === `${table}_app_access`);
      const denyPolicy = rows.find((row) => row.policyname === `${table}_deny_clients`);

      expect(appPolicy, `${table}_app_access exists`).toBeDefined();
      expect(appPolicy?.roles, `${table}_app_access role`).toEqual(["leavetrack_app"]);
      expect(appPolicy?.qual, `${table}_app_access is an allow`).toBe("true");

      expect(denyPolicy, `${table}_deny_clients exists`).toBeDefined();
      expect(denyPolicy?.roles.slice().sort(), `${table}_deny_clients roles`).toEqual([
        "anon",
        "authenticated",
      ]);
      expect(denyPolicy?.qual, `${table}_deny_clients is a deny`).toBe("false");
      // Permissive policies are OR'd; a restrictive deny still wins if someone
      // later adds a permissive allow policy for the client roles.
      expect(denyPolicy?.permissive, `${table}_deny_clients is restrictive`).toBe("RESTRICTIVE");
    }
  });

  it("covers every public table with RLS and both required policies", async () => {
    const tables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity
      from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
        and c.relname <> 'schema_migrations'
      order by 1
    `;
    const policies = await sql<{ tablename: string; policyname: string }[]>`
      select tablename, policyname
      from pg_policies
      where schemaname = 'public'
    `;

    expect(tables.length).toBeGreaterThanOrEqual(TABLES.length);

    for (const { relname, relrowsecurity } of tables) {
      expect(relrowsecurity, `RLS flag for ${relname}`).toBe(true);

      const names = new Set(
        policies
          .filter((policy) => policy.tablename === relname)
          .map((policy) => policy.policyname),
      );
      expect(names.has(`${relname}_app_access`), `${relname}_app_access exists`).toBe(true);
      expect(names.has(`${relname}_deny_clients`), `${relname}_deny_clients exists`).toBe(true);
    }
  });

  it("grants no column-level privileges on public tables", async () => {
    const [row] = await sql<{ columns_with_acl: number }[]>`
      select count(*)::int as columns_with_acl
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
        and a.attnum > 0
        and not a.attisdropped
        and a.attacl is not null
    `;

    expect(row.columns_with_acl).toBe(0);
  });

  it("keeps leavetrack_app unprivileged outside its grant matrix", async () => {
    const [row] = await sql<
      {
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
      }[]
    >`
      select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
      from pg_roles
      where rolname = 'leavetrack_app'
    `;

    expect(row).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
  });

  it("does not let client roles execute the application functions", async () => {
    for (const name of ["set_updated_at()", "prevent_hard_delete()", "prevent_audit_update()"]) {
      const [exists] = await sql<{ present: boolean }[]>`
        select to_regprocedure(${`public.${name}`}) is not null as present
      `;
      if (!exists.present) {
        continue;
      }

      for (const role of CLIENT_ROLES) {
        const [row] = await sql<{ allowed: boolean }[]>`
          select has_function_privilege(
            ${role}::name,
            ${`public.${name}`}::text,
            'EXECUTE'::text
          ) as allowed
        `;
        expect(row.allowed, `${role} EXECUTE public.${name}`).toBe(false);
      }
    }
  });

  it("has no default client grants for tables created by the migration role", async () => {
    const [row] = await sql<{ client_grants: number }[]>`
      select count(*)::int as client_grants
      from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) a
      join pg_roles grantee on grantee.oid = a.grantee
      where d.defaclobjtype = 'r'
        and d.defaclnamespace = 'public'::regnamespace
        and d.defaclrole = (select oid from pg_roles where rolname = current_user)
        and grantee.rolname in ('anon', 'authenticated')
    `;

    expect(row.client_grants).toBe(0);
  });

  it("does not let newly created tables inherit client privileges", async (ctx) => {
    if (!isLocalDatabase(process.env.DATABASE_URL)) {
      // Never run DDL against a remote database from the test suite.
      ctx.skip();
      return;
    }

    const [capability] = await sql<{ can_create: boolean }[]>`
      select has_schema_privilege(current_user, 'public', 'CREATE') as can_create
    `;
    if (!capability.can_create) {
      ctx.skip();
      return;
    }

    const probe = `db_auth_probe_${randomUUID().replace(/-/g, "")}`;

    try {
      await sql.unsafe(`create table public.${probe} (id integer)`);

      for (const role of CLIENT_ROLES) {
        expect(await tablePrivilege(sql, role, probe, "SELECT"), `${role} probe SELECT`).toBe(
          false,
        );
        expect(await tablePrivilege(sql, role, probe, "INSERT"), `${role} probe INSERT`).toBe(
          false,
        );
      }
    } finally {
      await sql.unsafe(`drop table if exists public.${probe}`);
    }
  });

  it("lets leavetrack_app read users and update balances", async (ctx) => {
    if (!(await canSetRole(sql, "leavetrack_app"))) {
      ctx.skip();
      return;
    }

    const [row] = await sql.begin(async (tx) => {
      await tx.unsafe("set local role leavetrack_app");
      const [count] = await tx<{ count: number }[]>`select count(*)::int as count from users`;
      await tx`update leave_balances set balance = balance where false`;
      return [count];
    });

    expect(row.count).toBeGreaterThan(0);
  });

  it("denies leavetrack_app a hard delete", async (ctx) => {
    if (!(await canSetRole(sql, "leavetrack_app"))) {
      ctx.skip();
      return;
    }

    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role leavetrack_app");
        await tx`delete from leave_requests where false`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies anon and authenticated reads", async (ctx) => {
    for (const role of CLIENT_ROLES) {
      if (!(await canSetRole(sql, role))) {
        ctx.skip();
        return;
      }

      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select count(*) from users`;
        }),
        `${role} read must fail`,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});

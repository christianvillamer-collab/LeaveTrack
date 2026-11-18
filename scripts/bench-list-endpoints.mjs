import { randomUUID } from "node:crypto";

import postgres from "postgres";

// This harness writes a synthetic 800-user dataset. It only accepts the named
// disposable database and rolls the whole load back, so a mistyped production
// URL can never be benchmarked (or mutated).
const REQUIRED_URL = "postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e207_verify";
const ROLLBACK_SENTINEL = "E2-13_BENCHMARK_ROLLBACK";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (databaseUrl !== REQUIRED_URL || directUrl !== REQUIRED_URL) {
  fail(
    "E2-13 benchmark requires DATABASE_URL and DIRECT_URL to both be " +
      "postgres://leavetrack:leavetrack@localhost:55432/leavetrack_e207_verify",
  );
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: false,
});

const managerCount = 8;
const employeeCount = 800;
const requestsPerEmployee = 25;
const warmupSamples = 5;
const measuredSamples = 120;
const pageSize = 25;

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

function timingStats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(3)),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

async function measure(statement) {
  for (let index = 0; index < warmupSamples; index += 1) {
    await statement();
  }

  const durations = [];
  for (let index = 0; index < measuredSamples; index += 1) {
    const start = performance.now();
    await statement();
    durations.push(performance.now() - start);
  }

  return timingStats(durations);
}

function collectIndexes(node, found = new Set()) {
  if (!node || typeof node !== "object") return found;

  if (typeof node["Index Name"] === "string") {
    found.add(node["Index Name"]);
  }
  for (const child of node.Plans ?? []) {
    collectIndexes(child, found);
  }
  return found;
}

function collectNodeTypes(node, found = new Set()) {
  if (!node || typeof node !== "object") return found;

  if (typeof node["Node Type"] === "string") {
    found.add(node["Node Type"]);
  }
  for (const child of node.Plans ?? []) {
    collectNodeTypes(child, found);
  }
  return found;
}

async function explain(execute, label, statement) {
  const [row] = await execute`explain (analyze, buffers, format json) ${statement}`;
  const rawPlan = Object.values(row ?? {})[0];
  const plans = Array.isArray(rawPlan) ? rawPlan : [rawPlan];
  const plan = plans[0] ?? {};

  return {
    label,
    planningTimeMs: Number((plan["Planning Time"] ?? 0).toFixed(3)),
    executionTimeMs: Number((plan["Execution Time"] ?? 0).toFixed(3)),
    indexes: [...collectIndexes(plan.Plan)].sort(),
    nodeTypes: [...collectNodeTypes(plan.Plan)].sort(),
  };
}

function listQueries(execute, ids, status) {
  return {
    myRequests: (limit, offset) => execute`
      select
        count(*) over ()::int as total,
        r.id,
        (r.end_date - r.start_date + 1)::int as days,
        r.status::text as status,
        r.created_at,
        lt.id as leave_type_id,
        lt.name as leave_type_name,
        lt.tracks_balance
      from leave_requests r
      join leave_types lt on lt.id = r.leave_type_id
      where r.user_id = ${ids.employeeId}
        and r.is_deleted = false
        and (${status}::request_status is null or r.status = ${status}::request_status)
      order by r.created_at desc, r.id desc
      limit ${limit}
      offset ${offset}
    `,
    teamRequests: (limit, offset) => execute`
      select
        count(*) over ()::int as total,
        r.id,
        (r.end_date - r.start_date + 1)::int as days,
        r.reason,
        r.status::text as status,
        r.created_at,
        e.id as employee_id,
        e.name as employee_name,
        lt.id as leave_type_id,
        lt.name as leave_type_name,
        lt.tracks_balance
      from leave_requests r
      join users e on e.id = r.user_id
      join leave_types lt on lt.id = r.leave_type_id
      where e.manager_id = ${ids.managerId}
        and r.is_deleted = false
        and (${status}::request_status is null or r.status = ${status}::request_status)
      order by r.created_at desc, r.id desc
      limit ${limit}
      offset ${offset}
    `,
    scopedRequests: (limit, offset) => execute`
      select
        count(*) over ()::int as total,
        r.id,
        r.reason,
        r.status::text as status,
        r.created_at,
        e.id as employee_id,
        e.name as employee_name,
        lt.id as leave_type_id,
        lt.name as leave_type_name,
        lt.tracks_balance
      from leave_requests r
      join users e on e.id = r.user_id
      join leave_types lt on lt.id = r.leave_type_id
      where r.is_deleted = false
        and (${status}::request_status is null or r.status = ${status}::request_status)
      order by r.created_at desc, r.id desc
      limit ${limit}
      offset ${offset}
    `,
    auditEvents: (limit, offset) => execute`
      select
        count(*) over ()::int as total,
        a.id,
        a.leave_request_id as request_id,
        a.action,
        coalesce(a.detail, '') as detail,
        a.occurred_at,
        e.id as employee_id,
        e.name as employee_name,
        e.email as employee_email,
        ac.id as actor_id,
        ac.name as actor_name,
        ac.email as actor_email
      from audit_log a
      join leave_requests r on r.id = a.leave_request_id
      join users e on e.id = r.user_id
      join users ac on ac.id = a.actor_id
      where r.user_id = ${ids.employeeId}
        and r.is_deleted = false
        and (${null}::date is null or a.occurred_at >= (${null}::date at time zone 'UTC'))
        and (${null}::date is null or a.occurred_at < ((${null}::date + 1) at time zone 'UTC'))
        and (${status}::request_status is null or r.status = ${status}::request_status)
      order by a.occurred_at desc, a.id desc
      limit ${limit}
      offset ${offset}
    `,
  };
}

async function seedSyntheticLoad(execute, runId) {
  const managers = await execute`
    insert into users (name, email, role)
    select
      'E2-13 Bench Manager ' || g,
      ${`bench-e2-13-${runId}`} || '-manager-' || g || '@example.test',
      'manager'::user_role
    from generate_series(1, ${managerCount}) g
    returning id
  `;
  const managerIds = managers.map((row) => row.id);

  const employees = await execute`
    insert into users (name, email, role, manager_id)
    select
      'E2-13 Bench Employee ' || g,
      ${`bench-e2-13-${runId}`} || '-employee-' || g || '@example.test',
      'employee'::user_role,
      (${managerIds}::uuid[])[((g - 1) % ${managerCount}) + 1]
    from generate_series(1, ${employeeCount}) g
    returning id
  `;
  const employeeIds = employees.map((row) => row.id);

  const [type] = await execute`
    select id from leave_types where name = 'Vacation' limit 1
  `;
  if (!type) {
    throw new Error("Seeded Vacation leave type is missing. Run npm run db:seed first.");
  }

  await execute`
    with numbered_employees as (
      select user_id, ordinal
      from unnest(${employeeIds}::uuid[]) with ordinality as e(user_id, ordinal)
    ), seeded as (
      select n.user_id, u.manager_id, n.ordinal, g
      from numbered_employees n
      join users u on u.id = n.user_id
      cross join generate_series(1, ${requestsPerEmployee}) g
    )
    insert into leave_requests (
      user_id,
      leave_type_id,
      start_date,
      end_date,
      reason,
      status,
      decided_by,
      decided_at,
      created_at
    )
    select
      user_id,
      ${type.id}::uuid,
      date '2025-01-01' + (((g - 1) % 20))::int,
      date '2025-01-01' + (((g - 1) % 20))::int + 2,
      'E2-13 benchmark request',
      case g % 3 when 0 then 'rejected' when 1 then 'approved' else 'pending' end::request_status,
      case when g % 3 <> 2 then manager_id else null end,
      case
        when g % 3 <> 2
          then now() - ((g * 37 + ordinal * 11)::int || ' days')::interval + interval '5 minutes'
        else null
      end,
      now() - ((g * 37 + ordinal * 11)::int || ' days')::interval
    from seeded
  `;

  await execute`
    insert into audit_log (leave_request_id, actor_id, action, detail, occurred_at)
    select
      r.id,
      coalesce(r.decided_by, ${managerIds[0]}::uuid),
      'submitted'::text,
      'E2-13 benchmark submission',
      r.created_at + interval '1 minute'
    from leave_requests r
    where r.user_id = any(${employeeIds}::uuid[])
  `;

  await execute`
    insert into audit_log (leave_request_id, actor_id, action, detail, occurred_at)
    select
      r.id,
      r.decided_by,
      r.status::text,
      'E2-13 benchmark decision',
      r.decided_at
    from leave_requests r
    where r.user_id = any(${employeeIds}::uuid[])
      and r.status <> 'pending'
  `;

  await execute`analyze leave_requests`;
  await execute`analyze audit_log`;
  await execute`analyze users`;

  const [scope] = await execute`
    select
      count(*)::int as total,
      count(*) filter (where r.status = 'pending')::int as pending
    from leave_requests r
    join users e on e.id = r.user_id
    where e.manager_id = ${managerIds[0]}
      and r.is_deleted = false
  `;

  const expectedTotal = (employeeCount / managerCount) * requestsPerEmployee;
  // Status is assigned with g % 3, so 1..25 yields eight pending rows (g = 2, 5, …, 23).
  const expectedPending =
    (employeeCount / managerCount) * Math.floor((requestsPerEmployee + 1) / 3);
  if (scope.total !== expectedTotal || scope.pending !== expectedPending) {
    throw new Error(
      `Manager scope check failed: got ${scope.total}/${scope.pending}, expected ${expectedTotal}/${expectedPending}`,
    );
  }

  return { employeeIds, managerIds };
}

async function run() {
  const [identity] = await sql`
    select current_database() as database, current_user as role
  `;
  if (identity.database !== "leavetrack_e207_verify") {
    throw new Error(`Refusing to benchmark database ${identity.database}`);
  }

  const runId = randomUUID();
  let report;

  try {
    await sql.begin(async (execute) => {
      const ids = await seedSyntheticLoad(execute, runId);
      const status = "pending";
      const targetEmployeeId = ids.employeeIds[0];
      const targetManagerId = ids.managerIds[0];
      const queries = listQueries(
        execute,
        { employeeId: targetEmployeeId, managerId: targetManagerId },
        status,
      );

      const statements = {
        myRequests: () => queries.myRequests(pageSize, 0),
        teamRequests: () => queries.teamRequests(pageSize, pageSize * 9),
        scopedRequests: () => queries.scopedRequests(pageSize, pageSize * 39),
        auditEvents: () => queries.auditEvents(pageSize, 0),
      };

      const timings = {};
      for (const [name, statement] of Object.entries(statements)) {
        timings[name] = await measure(statement);
      }

      const plans = [
        await explain(execute, "myRequests", statements.myRequests()),
        await explain(execute, "teamRequests", statements.teamRequests()),
        await explain(execute, "scopedRequests", statements.scopedRequests()),
        await explain(execute, "auditEvents", statements.auditEvents()),
      ];

      report = {
        generatedAt: new Date().toISOString(),
        database: identity.database,
        databaseRole: identity.role,
        dataset: {
          managers: managerCount,
          employees: employeeCount,
          requestsPerEmployee,
          totalRequests: managerCount * (employeeCount / managerCount) * requestsPerEmployee,
          targetManagerId,
          targetEmployeeId,
          statusFilter: status,
        },
        method: {
          connection: "single local Postgres connection, one rolled-back transaction",
          warmupSamples,
          measuredSamples,
          pageSize,
          concurrency: 1,
          note: "Database-only latency; HTTP and browser time are excluded (E2-14 covers 800-user HTTP load).",
        },
        timings,
        plans,
      };

      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === ROLLBACK_SENTINEL)) {
      throw error;
    }
  }

  return report;
}

let report;
try {
  report = await run();
} catch (error) {
  if (!(error instanceof Error && error.message === ROLLBACK_SENTINEL)) {
    process.stderr.write(`Benchmark failed: ${error.message}\n${error.stack ?? ""}\n`);
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}

if (report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

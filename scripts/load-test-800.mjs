import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

// E2-14 is an HTTP-level load test. It writes requests and auth users, so it
// only accepts a dedicated disposable database. The E2-13 DB-only benchmark
// uses a different database and stays untouched.
const LOAD_DATABASE = "leavetrack_e214_load";
const REQUIRED_URL = `postgres://leavetrack:leavetrack@localhost:55432/${LOAD_DATABASE}`;
const REPORT_PATH = "docs/performance/e2-14-results.json";
const P95_LIMIT_MS = 500;
const MAX_COOKIE_CHARS = 3180;
const SEED_ONLY = process.argv.includes("--seed-only");

const EMPLOYEE_COUNT = 800;
const MANAGER_COUNT = 8;
const HR_COUNT = 1;
const REQUESTS_PER_EMPLOYEE = 25;
const VIRTUAL_USERS = EMPLOYEE_COUNT;
// Supabase Auth rate-limits session creation to ~40 per window per IP, so the
// 800 VUs share a small pool of real sessions rather than one session each.
const AUTH_POOL_SIZE = Math.floor(positiveNumber("LOAD_TEST_AUTH_POOL", 32));
if (AUTH_POOL_SIZE < MANAGER_COUNT + HR_COUNT + 1) {
  fail(`LOAD_TEST_AUTH_POOL must be at least ${MANAGER_COUNT + HR_COUNT + 1}.`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function positiveNumber(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a positive number.`);
  }
  return value;
}

const baseUrlRaw = process.env.LOAD_TEST_BASE_URL?.trim() || "http://localhost:3000";
let baseUrl;
try {
  baseUrl = new URL(baseUrlRaw);
} catch {
  fail("LOAD_TEST_BASE_URL must be an absolute http URL.");
}
if (baseUrl.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
  fail("LOAD_TEST_BASE_URL must point at localhost over http.");
}

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
if (databaseUrl !== REQUIRED_URL || directUrl !== REQUIRED_URL) {
  fail(`E2-14 requires DATABASE_URL and DIRECT_URL to both be ${REQUIRED_URL}`);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const password = process.env.SEED_AUTH_PASSWORD;
if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  fail(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
      "SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}
if (!password || password.length < 8) {
  fail("SEED_AUTH_PASSWORD must be set to at least 8 characters.");
}

const durationMs = positiveNumber("LOAD_TEST_DURATION_SECONDS", 60) * 1000;
const rampMs = positiveNumber("LOAD_TEST_RAMP_SECONDS", 10) * 1000;
const thinkMs = positiveNumber("LOAD_TEST_THINK_MS", 500);
const authConcurrency = Math.floor(positiveNumber("LOAD_TEST_AUTH_CONCURRENCY", 5));
const requestTimeoutMs = positiveNumber("LOAD_TEST_TIMEOUT_MS", 15) * 1000;

const sql = postgres(directUrl, { max: 4, prepare: false, ssl: false });
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function deterministicUuid(prefix, index) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function isoDate(daysFromEpoch) {
  return new Date(daysFromEpoch * 86_400_000).toISOString().slice(0, 10);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

function timingStats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { samples: 0, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(3)),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

/** postgres.js binds one parameter per value; keep batches well under the 65534 limit. */
async function insertInBatches(rows, insert) {
  const batchSize = 1000;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await insert(rows.slice(offset, offset + batchSize));
  }
}

async function seedDatabase(execute) {
  const [identity] = await execute`select current_database() as database`;
  if (identity.database !== LOAD_DATABASE) {
    throw new Error(`Refusing to load database ${identity.database}`);
  }

  const [leaveType] = await execute`select id from leave_types where name = 'Vacation' limit 1`;
  if (!leaveType) {
    throw new Error("Seeded Vacation leave type is missing. Run npm run db:seed first.");
  }

  const managers = Array.from({ length: MANAGER_COUNT }, (_, index) => ({
    id: deterministicUuid("e2140001", index + 1),
    name: `E2-14 Load Manager ${index + 1}`,
    email: `load-e214-manager-${index + 1}@example.test`,
    role: "manager",
  }));
  const employees = Array.from({ length: EMPLOYEE_COUNT }, (_, index) => ({
    id: deterministicUuid("e2140002", index + 1),
    name: `E2-14 Load Employee ${index + 1}`,
    email: `load-e214-employee-${index + 1}@example.test`,
    role: "employee",
    manager_id: managers[index % MANAGER_COUNT].id,
  }));
  const hrUsers = Array.from({ length: HR_COUNT }, (_, index) => ({
    id: deterministicUuid("e2140005", index + 1),
    name: `E2-14 Load HR ${index + 1}`,
    email: `load-e214-hr-${index + 1}@example.test`,
    role: "hr_admin",
  }));

  await execute`insert into users ${execute(managers)} on conflict (lower(email)) do update set name = excluded.name, role = excluded.role`;
  await execute`insert into users ${execute(employees)} on conflict (lower(email)) do update set name = excluded.name, role = excluded.role, manager_id = excluded.manager_id`;
  await execute`insert into users ${execute(hrUsers)} on conflict (lower(email)) do update set name = excluded.name, role = excluded.role`;

  const allUsers = [...managers, ...employees, ...hrUsers];
  const balances = allUsers.map((user) => ({
    user_id: user.id,
    leave_type_id: leaveType.id,
    balance: 120,
  }));
  await execute`insert into leave_balances ${execute(balances)} on conflict (user_id, leave_type_id) do nothing`;

  const requests = [];
  const auditRows = [];
  let auditIndex = 0;
  for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex += 1) {
    const employee = employees[employeeIndex];
    for (let cycle = 1; cycle <= REQUESTS_PER_EMPLOYEE; cycle += 1) {
      const requestIndex = employeeIndex * REQUESTS_PER_EMPLOYEE + cycle;
      const status = cycle % 3 === 1 ? "approved" : cycle % 3 === 0 ? "rejected" : "pending";
      const decidedBy = status === "pending" ? null : employee.manager_id;
      const createdAt = new Date(Date.UTC(2025, 0, 1) + requestIndex * 60_000);
      const decidedAt = decidedBy ? new Date(createdAt.getTime() + 300_000) : null;
      const requestId = deterministicUuid("e2140003", requestIndex);
      requests.push({
        id: requestId,
        user_id: employee.id,
        leave_type_id: leaveType.id,
        start_date: isoDate(20_000 + cycle),
        end_date: isoDate(20_002 + cycle),
        reason: "E2-14 load test request",
        status,
        decided_by: decidedBy,
        decided_at: decidedAt,
        created_at: createdAt,
      });
      auditIndex += 1;
      auditRows.push({
        id: deterministicUuid("e2140004", auditIndex),
        leave_request_id: requestId,
        actor_id: employee.id,
        action: "submitted",
        detail: "E2-14 load test submission",
        occurred_at: new Date(createdAt.getTime() + 60_000),
      });
      if (status !== "pending") {
        auditIndex += 1;
        auditRows.push({
          id: deterministicUuid("e2140004", auditIndex),
          leave_request_id: requestId,
          actor_id: decidedBy,
          action: status,
          detail: "E2-14 load test decision",
          occurred_at: decidedAt,
        });
      }
    }
  }

  await insertInBatches(
    requests,
    (batch) => execute`insert into leave_requests ${execute(batch)} on conflict (id) do nothing`,
  );
  await insertInBatches(
    auditRows,
    (batch) => execute`insert into audit_log ${execute(batch)} on conflict (id) do nothing`,
  );
  await execute`analyze users`;
  await execute`analyze leave_requests`;
  await execute`analyze audit_log`;
  await execute`analyze leave_balances`;

  const [scope] = await execute`
    select
      count(*)::int as total,
      count(*) filter (where r.status = 'pending')::int as pending
    from leave_requests r
    join users e on e.id = r.user_id
    where e.manager_id = ${managers[0].id}
      and r.is_deleted = false
  `;
  const expectedTotal = (EMPLOYEE_COUNT / MANAGER_COUNT) * REQUESTS_PER_EMPLOYEE;
  const expectedPending =
    (EMPLOYEE_COUNT / MANAGER_COUNT) * Math.floor((REQUESTS_PER_EMPLOYEE + 1) / 3);
  if (scope.total !== expectedTotal || scope.pending !== expectedPending) {
    throw new Error(
      `Manager scope check failed: got ${scope.total}/${scope.pending}, expected ${expectedTotal}/${expectedPending}`,
    );
  }

  return { leaveTypeId: leaveType.id, managers, employees, hrUsers };
}

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function provisionAuthUsers(execute, users) {
  const existing = new Map(
    (await listAllAuthUsers()).map((user) => [user.email?.toLowerCase(), user]),
  );

  await mapWithConcurrency(users, authConcurrency, async (user) => {
    const current = existing.get(user.email.toLowerCase());
    if (!current) {
      const { error } = await admin.auth.admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: { name: user.name },
      });
      if (error) throw new Error(`${user.email}: ${error.message}`);
      return;
    }
    const { error } = await admin.auth.admin.updateUserById(current.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`${user.email}: ${error.message}`);
  });

  const refreshed = await listAllAuthUsers();
  const byEmail = new Map(refreshed.map((user) => [user.email?.toLowerCase(), user]));
  const emails = [];
  const subjects = [];
  for (const user of users) {
    const authUser = byEmail.get(user.email.toLowerCase());
    if (!authUser) throw new Error(`${user.email}: auth user was not created`);
    emails.push(user.email);
    subjects.push(authUser.id);
  }

  await execute`
    update users u
    set auth_subject = linked.auth_subject
    from (
      select * from unnest(${emails}::text[], ${subjects}::uuid[]) as linked(email, auth_subject)
    ) as linked
    where lower(u.email) = lower(linked.email)
  `;
}

function sessionCookie(session) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const name = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  if (encodeURIComponent(value).length > MAX_COOKIE_CHARS) {
    throw new Error("Session cookie exceeds the SSR chunk limit; reduce auth user metadata.");
  }
  return `${name}=${value}`;
}

async function signIn(user) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (!error && data.session) {
      return sessionCookie(data.session);
    }
    if (error?.status !== 429 || attempt === 4) {
      throw new Error(`${user.email}: ${error?.message ?? "no session returned"}`);
    }
    // Auth rate limits are per-IP and windowed; back off instead of failing the run.
    process.stdout.write(`${user.email}: rate limited, retry ${attempt}/3\n`);
    await delay(attempt * 30_000);
  }
  throw new Error(`${user.email}: no session returned`);
}

async function timedFetch(path, cookie, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: options.method ?? "GET",
      headers: {
        cookie,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    await response.arrayBuffer();
    const elapsed = performance.now() - started;
    return {
      elapsed,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
    };
  } catch (error) {
    return {
      elapsed: performance.now() - started,
      status: 0,
      ok: false,
      message: error instanceof Error ? error.message : "transport error",
    };
  }
}

async function runLoad(fixture) {
  const { managers, employees, hrUsers, leaveTypeId } = fixture;
  const virtualUsers = [
    ...managers.map((user) => ({ user, role: "manager" })),
    ...hrUsers.map((user) => ({ user, role: "hr" })),
    ...employees.slice(0, VIRTUAL_USERS - managers.length - hrUsers.length).map((user) => ({
      user,
      role: "employee",
    })),
  ];
  if (virtualUsers.length !== VIRTUAL_USERS) {
    throw new Error(`Expected ${VIRTUAL_USERS} virtual users, got ${virtualUsers.length}`);
  }

  const authPool = [
    ...managers.map((user) => ({ user, role: "manager" })),
    ...hrUsers.map((user) => ({ user, role: "hr" })),
    ...employees
      .slice(0, AUTH_POOL_SIZE - managers.length - hrUsers.length)
      .map((user) => ({ user, role: "employee" })),
  ];
  const poolSessions = await mapWithConcurrency(authPool, authConcurrency, async ({ user }) => ({
    cookie: await signIn(user),
    email: user.email,
  }));
  const byRole = {
    manager: poolSessions.slice(0, managers.length),
    hr: poolSessions.slice(managers.length, managers.length + hrUsers.length),
    employee: poolSessions.slice(managers.length + hrUsers.length),
  };
  const nextIndex = { manager: 0, hr: 0, employee: 0 };
  const sessions = virtualUsers.map(({ role }) => {
    const list = byRole[role];
    const session = list[nextIndex[role] % list.length];
    nextIndex[role] += 1;
    return session;
  });

  const endpoints = {
    myList: () => "/api/leave-requests?scope=mine&page=1&pageSize=25",
    teamList: () => "/api/leave-requests?scope=team&page=1&pageSize=25",
    balance: () => "/balance",
    requestsPage: () => "/requests?page=1&pageSize=25",
    audit: () => `/api/audit/${employees[0].id}?page=1&pageSize=25`,
  };

  for (const [name, path] of Object.entries(endpoints)) {
    const role = name === "teamList" ? "manager" : name === "audit" ? "hr" : "employee";
    const index = virtualUsers.findIndex((entry) => entry.role === role);
    const result = await timedFetch(path(), sessions[index].cookie);
    if (!result.ok) {
      throw new Error(`Warmup failed for ${name}: status ${result.status}`);
    }
  }

  const samples = Object.fromEntries(
    Object.keys(endpoints)
      .concat("submit")
      .map((name) => [name, []]),
  );
  const responses = Object.fromEntries(
    Object.keys(endpoints)
      .concat("submit")
      .map((name) => [name, { success: 0, failure: 0 }]),
  );
  const errors = [];
  const deadline = Date.now() + rampMs + durationMs;

  function record(name, result) {
    samples[name].push(result.elapsed);
    responses[name][result.ok ? "success" : "failure"] += 1;
    if (!result.ok && errors.length < 20) {
      errors.push({ endpoint: name, status: result.status, message: result.message ?? null });
    }
  }

  async function runVirtualUser(index) {
    const { role } = virtualUsers[index];
    const { cookie } = sessions[index];
    const startAt = Date.now() + Math.round((index / VIRTUAL_USERS) * rampMs);
    const delayMs = Math.max(0, startAt - Date.now());
    if (delayMs > 0) await delay(delayMs);

    let iteration = 0;
    while (Date.now() < deadline) {
      let name;
      let path;
      let options;
      if (role === "manager") {
        name = iteration % 4 === 0 ? "myList" : "teamList";
      } else if (role === "hr") {
        name = iteration % 4 === 0 ? "balance" : "audit";
      } else if (iteration % 10 === 0) {
        name = "submit";
        const start = isoDate(20_100 + index * 100 + iteration);
        path = "/api/leave-requests";
        options = {
          method: "POST",
          body: {
            leaveTypeId,
            startDate: start,
            endDate: isoDate(20_102 + index * 100 + iteration),
            reason: "E2-14 load test submission",
          },
        };
      } else {
        name = ["myList", "balance", "requestsPage"][iteration % 3];
      }

      if (!path) path = endpoints[name]();
      record(name, await timedFetch(path, cookie, options));
      iteration += 1;
      const remaining = deadline - Date.now();
      if (remaining > 0) await delay(Math.min(thinkMs, remaining));
    }
    return iteration;
  }

  const iterations = await mapWithConcurrency(
    Array.from({ length: VIRTUAL_USERS }, (_, index) => index),
    VIRTUAL_USERS,
    runVirtualUser,
  );

  const timings = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [name, timingStats(values)]),
  );
  const latencyNames = Object.keys(endpoints);
  const p95Failures = latencyNames.filter(
    (name) => timings[name].samples > 0 && timings[name].p95Ms >= P95_LIMIT_MS,
  );
  const totalFailures = Object.values(responses).reduce((sum, value) => sum + value.failure, 0);
  const passed = p95Failures.length === 0 && totalFailures === 0;

  return {
    generatedAt: new Date().toISOString(),
    task: "E2-14",
    dataset: {
      employees: EMPLOYEE_COUNT,
      managers: MANAGER_COUNT,
      hrAdmins: HR_COUNT,
      requestsSeeded: EMPLOYEE_COUNT * REQUESTS_PER_EMPLOYEE,
      virtualUsers: VIRTUAL_USERS,
    },
    config: {
      durationSeconds: durationMs / 1000,
      rampSeconds: rampMs / 1000,
      thinkMs,
      requestTimeoutMs,
      p95LimitMs: P95_LIMIT_MS,
      authPoolSize: AUTH_POOL_SIZE,
    },
    iterations: iterations.reduce((sum, value) => sum + value, 0),
    timings,
    responses,
    errors,
    thresholds: { p95Failures, totalFailures, passed },
    result: passed ? "pass" : "fail",
  };
}

async function run() {
  let fixture;
  await sql.begin(async (execute) => {
    fixture = await seedDatabase(execute);
    await provisionAuthUsers(execute, [
      ...fixture.managers,
      ...fixture.employees,
      ...fixture.hrUsers,
    ]);
  });

  process.stdout.write(
    `Seeded ${fixture.employees.length} employees, ${fixture.managers.length} managers and ` +
      `${fixture.hrUsers.length} HR user(s). Auth identities linked.\n`,
  );
  if (SEED_ONLY) return;

  const report = await runLoad(fixture);
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.thresholds.passed) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    process.stderr.write(`E2-14 load test failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });

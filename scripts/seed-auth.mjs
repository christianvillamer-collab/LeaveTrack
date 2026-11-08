import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const password = process.env.SEED_AUTH_PASSWORD;
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  fail(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. This script is for local/dev projects only.",
  );
}

if (!connectionString) {
  fail("DATABASE_URL (or DIRECT_URL) is not set, so there are no employee rows to link.");
}

if (!password || password.length < 8) {
  fail("SEED_AUTH_PASSWORD must be set to at least 8 characters.");
}

if (process.env.NODE_ENV === "production" && process.env.SEED_AUTH_ALLOW_PRODUCTION !== "1") {
  fail(
    "Refusing to create auth users in production. Set SEED_AUTH_ALLOW_PRODUCTION=1 only if you are sure.",
  );
}

const isLocal = /(?:localhost|127\.0\.0\.1)/.test(connectionString);
const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: isLocal || process.env.PGSSLMODE === "disable" ? false : "require",
});

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllAuthUsers() {
  const users = [];

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });

    if (error) {
      throw error;
    }

    users.push(...data.users);

    if (data.users.length < 1000) {
      break;
    }
  }

  return users;
}

async function run() {
  const employees = await sql`
    select email, name
    from users
    order by email
  `;

  if (employees.length === 0) {
    process.stdout.write("No employee rows found; run npm run db:seed first.\n");
    return;
  }

  const existing = new Map(
    (await listAllAuthUsers()).map((user) => [user.email?.toLowerCase(), user]),
  );

  let created = 0;
  let updated = 0;

  for (const employee of employees) {
    const email = employee.email.trim();
    const current = existing.get(email.toLowerCase());

    if (!current) {
      const { error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: employee.name },
      });

      if (error) {
        throw new Error(`${email}: ${error.message}`);
      }

      created += 1;
      continue;
    }

    // Re-apply the dev password and confirmation so a rerun always yields a
    // known, usable account.
    const { error } = await admin.auth.admin.updateUserById(current.id, {
      password,
      email_confirm: true,
    });

    if (error) {
      throw new Error(`${email}: ${error.message}`);
    }

    updated += 1;
  }

  process.stdout.write(
    `Auth seed complete: ${created} created, ${updated} updated, ${employees.length} employee row(s).\n`,
  );
}

run()
  .catch((error) => {
    process.stderr.write(`Auth seed failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });

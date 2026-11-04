import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  process.stderr.write(
    "DATABASE_URL (or DIRECT_URL) is not set. Copy .env.example to .env.local and configure it.\n",
  );
  process.exit(1);
}

const isLocal = /(?:localhost|127\.0\.0\.1)/.test(connectionString);
const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: isLocal || process.env.PGSSLMODE === "disable" ? false : "require",
});

const migrationsDir = path.join(process.cwd(), "db", "migrations");

async function run() {
  await sql`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql`select filename from schema_migrations`).map((row) => row.filename),
  );
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  let count = 0;

  for (const file of files) {
    if (applied.has(file)) {
      process.stdout.write(`skip ${file} (already applied)\n`);
      continue;
    }

    const contents = await readFile(path.join(migrationsDir, file), "utf8");

    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`insert into schema_migrations (filename) values (${file})`;
    });

    process.stdout.write(`applied ${file}\n`);
    count += 1;
  }

  process.stdout.write(
    count === 0 ? "Database is up to date.\n" : `Applied ${count} migration(s).\n`,
  );
}

run()
  .catch((error) => {
    process.stderr.write(`Migration failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });

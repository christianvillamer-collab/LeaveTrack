import { readFile } from "node:fs/promises";
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

// The seed writes tables the least-privilege app role cannot touch
// (ADR-LeaveTrack-E005). Keep this on the owner connection.
const connectionRole = (() => {
  try {
    return decodeURIComponent(new URL(connectionString).username);
  } catch {
    return "";
  }
})();

if (connectionRole === "leavetrack_app") {
  process.stderr.write(
    "The seed needs the owner role, not leavetrack_app. Set DIRECT_URL to the owner connection.\n",
  );
  process.exit(1);
}

const isLocal = /(?:localhost|127\.0\.0\.1)/.test(connectionString);
const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: isLocal || process.env.PGSSLMODE === "disable" ? false : "require",
});

async function run() {
  const seedPath = path.join(process.cwd(), "db", "seed.sql");
  const contents = await readFile(seedPath, "utf8");
  await sql.unsafe(contents);
  process.stdout.write("Seed applied. Fixed ids + ON CONFLICT make this idempotent.\n");
}

run()
  .catch((error) => {
    process.stderr.write(`Seed failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });

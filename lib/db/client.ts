import "server-only";

import postgres from "postgres";

import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

type Sql = ReturnType<typeof postgres>;

let client: Sql | null = null;

/**
 * Lazy pooled client. Supabase transaction pooler requires `prepare: false`.
 * The client is created only when a caller actually queries (health probe,
 * request submission, DB-backed page); mock-only pages never open a connection.
 */
export function getDb(): Sql {
  const connectionString = env().DATABASE_URL;

  if (!connectionString) {
    throw new AppError(
      ERROR_CODES.DATABASE_NOT_CONFIGURED,
      "Database access is not configured.",
      503,
    );
  }

  const isLocal = /(?:localhost|127\.0\.0\.1)/.test(connectionString);

  client ??= postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    ssl: isLocal ? false : "require",
  });

  return client;
}

export async function checkDatabase(): Promise<"ok" | "not_configured" | "error"> {
  if (!env().DATABASE_URL) {
    return "not_configured";
  }

  try {
    await getDb()`select 1 as ok`;
    return "ok";
  } catch {
    return "error";
  }
}

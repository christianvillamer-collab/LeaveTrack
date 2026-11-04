import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === "" || URL.canParse(value), "must be a valid URL")
  .optional()
  .default("");

const optionalNonEmpty = z.string().trim().optional().default("");

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DATABASE_URL: optionalNonEmpty,
  DIRECT_URL: optionalNonEmpty,
  CRON_SECRET: optionalNonEmpty,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Parses server environment lazily. Day 0 must build with an empty env, so
 * database and provider values are optional; features that need them check at
 * call time instead of failing the build.
 */
export function env(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

export function appUrl(): string {
  return env().NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

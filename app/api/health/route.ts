import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { checkDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_VERSION = "0.1.0";

export const GET = withApiHandler("GET /api/health", async () => {
  const database = await checkDatabase();

  if (database === "error") {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, "The database health check failed.", 503);
  }

  return {
    status: "ok",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database,
      auth: "mock",
    },
  };
});

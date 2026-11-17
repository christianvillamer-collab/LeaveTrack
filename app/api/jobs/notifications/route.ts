import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { env } from "@/lib/config/env";
import { runNotificationOutbox } from "@/lib/notifications/worker";
import type { NotificationJobResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * System route, not a user session: it is public at the proxy layer and
 * authenticates itself with the shared Vercel Cron secret
 * (Authorization: Bearer $CRON_SECRET), exactly like the accrual job.
 */
function assertCronAuthorized(request: NextRequest): void {
  const secret = env().CRON_SECRET;

  if (!secret) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      "CRON_SECRET is not configured; the notification job cannot be triggered.",
      503,
    );
  }

  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw AppError.unauthenticated("A valid cron secret is required.");
  }
}

// Vercel Cron issues GET; both verbs share one handler so a manual POST retry
// behaves identically.
export const GET = withApiHandler<NotificationJobResult>(
  "GET /api/jobs/notifications",
  async (request) => {
    assertCronAuthorized(request);
    return runNotificationOutbox();
  },
);

export const POST = withApiHandler<NotificationJobResult>(
  "POST /api/jobs/notifications",
  async (request) => {
    assertCronAuthorized(request);
    return runNotificationOutbox();
  },
);

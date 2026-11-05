import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { env } from "@/lib/config/env";
import { runAccrual } from "@/lib/db/accrual";
import { accrualPeriod } from "@/lib/domain/accrual";
import type { AccrualResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * This is a system route, not a user session: the mock cookie role means
 * nothing here. It is public at the proxy layer and authenticates itself with
 * the shared Vercel Cron secret (Authorization: Bearer $CRON_SECRET).
 */
function assertCronAuthorized(request: NextRequest): void {
  const secret = env().CRON_SECRET;

  if (!secret) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      "CRON_SECRET is not configured; the accrual job cannot be triggered.",
      503,
    );
  }

  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw AppError.unauthenticated("A valid cron secret is required.");
  }
}

async function handleAccrual(request: NextRequest): Promise<AccrualResult> {
  assertCronAuthorized(request);

  return runAccrual(accrualPeriod());
}

// Vercel Cron issues GET; the architecture contract names POST. Both verbs run
// the same idempotent job so either scheduler works.
export const GET = withApiHandler<AccrualResult>("GET /api/jobs/accrual", handleAccrual);
export const POST = withApiHandler<AccrualResult>("POST /api/jobs/accrual", handleAccrual);

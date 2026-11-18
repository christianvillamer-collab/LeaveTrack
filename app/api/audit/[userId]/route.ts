import { z } from "zod";

import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canRunAudit } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { getAuditReport } from "@/lib/db/audit";
import type { AuditReport } from "@/lib/types";
import { auditReportQuerySchema } from "@/lib/validation/audit";

export const runtime = "nodejs";

export const GET = withApiHandler<AuditReport, { userId: string }>(
  "GET /api/audit/:userId",
  async (request, context) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    if (!canRunAudit({ id: session.id, role: session.role })) {
      throw AppError.forbidden("HR admin access is required.");
    }

    if (!context.params) {
      throw AppError.notFound("Employee not found.");
    }

    const { userId } = await context.params;
    const parsedId = z.uuid().safeParse(userId);

    if (!parsedId.success) {
      throw AppError.notFound("Employee not found.");
    }

    const query = auditReportQuerySchema.parse({
      employee: request.nextUrl.searchParams.get("employee") ?? undefined,
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
    });

    const report = await getAuditReport(parsedId.data, { from: query.from, to: query.to });

    if (!report) {
      throw AppError.notFound("Employee not found.");
    }

    return report;
  },
);

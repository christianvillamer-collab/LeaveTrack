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

    const param = (name: string) => request.nextUrl.searchParams.get(name) ?? undefined;
    const query = auditReportQuerySchema.parse({
      employee: param("employee"),
      from: param("from"),
      to: param("to"),
      status: param("status"),
      page: param("page"),
      pageSize: param("pageSize"),
      exportAll: param("exportAll"),
    });

    const report = await getAuditReport(parsedId.data, {
      from: query.from,
      to: query.to,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
      exportAll: query.exportAll,
    });

    if (!report) {
      throw AppError.notFound("Employee not found.");
    }

    return report;
  },
);

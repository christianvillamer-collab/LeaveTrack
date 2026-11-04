import { z } from "zod";

import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { getSession } from "@/lib/auth/session";
import { getAuditReport } from "@/lib/db/audit";
import { findUserByEmail } from "@/lib/db/users";
import type { AuditReport } from "@/lib/types";

export const runtime = "nodejs";

export const GET = withApiHandler<AuditReport, { userId: string }>(
  "GET /api/audit/:userId",
  async (_request, context) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    const viewer = await findUserByEmail(session.email);

    if (!viewer) {
      throw AppError.forbidden("No employee record is linked to this account.");
    }

    if (viewer.role !== "hr_admin") {
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

    const report = await getAuditReport(parsedId.data);

    if (!report) {
      throw AppError.notFound("Employee not found.");
    }

    return report;
  },
);

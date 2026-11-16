import { z } from "zod";

import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canOverrideRequests } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { overrideLeaveRequest } from "@/lib/db/leave";
import type { LeaveDecisionResult } from "@/lib/types";
import { overrideInputSchema } from "@/lib/validation/leave";

export const runtime = "nodejs";

export const POST = withApiHandler<LeaveDecisionResult, { id: string }>(
  "POST /api/leave-requests/:id/override",
  async (request, context) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    if (!canOverrideRequests({ id: session.id, role: session.role })) {
      throw AppError.forbidden("HR access is required.");
    }

    if (!context.params) {
      throw AppError.notFound("Leave request not found.");
    }

    const { id } = await context.params;
    const parsedId = z.uuid().safeParse(id);

    if (!parsedId.success) {
      throw AppError.notFound("Leave request not found.");
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw AppError.validation("Send a valid JSON request body.");
    }

    const input = overrideInputSchema.parse(body);

    return overrideLeaveRequest({
      requestId: parsedId.data,
      actorId: session.id,
      actorName: session.name,
      decision: input.decision,
      reason: input.reason,
    });
  },
);

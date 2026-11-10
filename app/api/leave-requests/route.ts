import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canViewTeam } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { createLeaveRequest, getMyLeaveData, getTeamLeaveData } from "@/lib/db/leave";
import { leaveRequestInputSchema, leaveRequestScopeSchema } from "@/lib/validation/leave";

export const runtime = "nodejs";

export const GET = withApiHandler("GET /api/leave-requests", async (request) => {
  const session = await getSession();

  if (!session) {
    throw AppError.unauthenticated();
  }

  const scope = leaveRequestScopeSchema.parse(
    request.nextUrl.searchParams.get("scope") ?? undefined,
  );

  if (scope === "team") {
    if (!canViewTeam({ id: session.id, role: session.role })) {
      throw AppError.forbidden("Manager access is required for scope=team.");
    }

    return getTeamLeaveData(session.id);
  }

  return getMyLeaveData(session.id);
});

export const POST = withApiHandler(
  "POST /api/leave-requests",
  async (request) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw AppError.validation("Send a valid JSON request body.");
    }

    const input = leaveRequestInputSchema.parse(body);

    return createLeaveRequest({
      userId: session.id,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
    });
  },
  { successStatus: 201 },
);

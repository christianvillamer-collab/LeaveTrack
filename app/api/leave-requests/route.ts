import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { getSession } from "@/lib/auth/session";
import { createLeaveRequest, getMyLeaveData, getTeamLeaveData } from "@/lib/db/leave";
import { findUserByEmail } from "@/lib/db/users";
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

  const user = await findUserByEmail(session.email);

  if (!user) {
    throw AppError.forbidden("No employee record is linked to this account.");
  }

  if (scope === "team") {
    if (user.role !== "manager") {
      throw AppError.forbidden("Manager access is required for scope=team.");
    }

    return getTeamLeaveData(user.id);
  }

  return getMyLeaveData(user.id);
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
    const user = await findUserByEmail(session.email);

    if (!user) {
      throw AppError.forbidden("No employee record is linked to this account.");
    }

    return createLeaveRequest({
      userId: user.id,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
    });
  },
  { successStatus: 201 },
);

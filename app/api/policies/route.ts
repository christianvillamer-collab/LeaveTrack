import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canConfigurePolicies } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { upsertPolicyRate } from "@/lib/db/policies";
import type { PolicyRateResult } from "@/lib/types";
import { policyRateInputSchema } from "@/lib/validation/policy";

export const runtime = "nodejs";

export const POST = withApiHandler<PolicyRateResult>("POST /api/policies", async (request) => {
  const session = await getSession();

  if (!session) {
    throw AppError.unauthenticated();
  }

  if (!canConfigurePolicies({ id: session.id, role: session.role })) {
    throw AppError.forbidden("HR access is required.");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw AppError.validation("Send a valid JSON request body.");
  }

  const input = policyRateInputSchema.parse(body);

  return upsertPolicyRate({
    actorId: session.id,
    userId: input.userId,
    leaveTypeId: input.leaveTypeId,
    accrualPerMonth: input.accrualPerMonth,
    effectiveFrom: input.effectiveFrom,
  });
});

import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canManagePeople } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { reassignManager, type ManagerAssignmentResult } from "@/lib/db/people";
import { managerAssignmentSchema, personIdSchema } from "@/lib/validation/people";

export const runtime = "nodejs";

interface Params {
  id: string;
}

export const POST = withApiHandler<ManagerAssignmentResult, Params>(
  "POST /api/people/:id/manager",
  async (request, { params }) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    if (!canManagePeople({ id: session.id, role: session.role })) {
      throw AppError.forbidden("HR access is required.");
    }

    const id = personIdSchema.parse((await params)?.id);

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw AppError.validation("Send a valid JSON request body.");
    }

    const input = managerAssignmentSchema.parse(body);

    return reassignManager(session.id, id, input.managerId);
  },
);

import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canManagePeople } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { updatePersonProfile, type PersonMutationResult } from "@/lib/db/people";
import { personIdSchema, personProfileSchema } from "@/lib/validation/people";

export const runtime = "nodejs";

interface Params {
  id: string;
}

export const POST = withApiHandler<PersonMutationResult, Params>(
  "POST /api/people/:id/profile",
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

    const input = personProfileSchema.parse(body);

    return updatePersonProfile(session.id, id, input);
  },
);

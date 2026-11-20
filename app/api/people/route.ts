import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canManagePeople } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { createPerson } from "@/lib/db/people";
import type { PersonDirectoryEntry } from "@/lib/types";
import { personCreateSchema } from "@/lib/validation/people";

export const runtime = "nodejs";

/** HR single-user create (E2-23). The actor comes from the session, never the body. */
export const POST = withApiHandler<PersonDirectoryEntry>(
  "POST /api/people",
  async (request) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    if (!canManagePeople({ id: session.id, role: session.role })) {
      throw AppError.forbidden("HR access is required.");
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw AppError.validation("Send a valid JSON request body.");
    }

    const input = personCreateSchema.parse(body);

    return createPerson(session.id, {
      name: input.name,
      email: input.email,
      role: input.role,
      managerEmail: input.managerEmail,
      jobTitle: input.jobTitle,
      team: input.team,
    });
  },
  { successStatus: 201 },
);

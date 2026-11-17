import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { canManagePeople } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { bulkImportPeople, type PeopleImportResult } from "@/lib/db/people";
import { peopleImportSchema } from "@/lib/validation/people";

export const runtime = "nodejs";

export const POST = withApiHandler<PeopleImportResult>(
  "POST /api/people/import",
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

    const rows = peopleImportSchema.parse(body);

    return bulkImportPeople(
      session.id,
      rows.map((row) => ({
        name: row.name,
        email: row.email,
        role: row.role,
        managerEmail: row.managerEmail,
        jobTitle: row.jobTitle,
        team: row.team,
      })),
    );
  },
  { successStatus: 201 },
);

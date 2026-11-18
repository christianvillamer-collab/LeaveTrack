import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { getSession } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/db/notifications";
import { notificationIdSchema } from "@/lib/validation/notifications";

export const runtime = "nodejs";

interface ReadResult {
  id: string;
  readAt: string;
}

export const POST = withApiHandler<ReadResult, { id: string }>(
  "POST /api/notifications/:id/read",
  async (_request, context) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    if (!context.params) {
      throw AppError.notFound("Notification not found.");
    }

    const { id } = await context.params;
    const parsedId = notificationIdSchema.safeParse(id);

    if (!parsedId.success) {
      throw AppError.notFound("Notification not found.");
    }

    // Ownership is enforced inside the SQL predicate; a foreign id 404s exactly
    // like a missing one.
    const readAt = await markNotificationRead(session.id, parsedId.data);

    if (!readAt) {
      throw AppError.notFound("Notification not found.");
    }

    return { id: parsedId.data, readAt };
  },
);

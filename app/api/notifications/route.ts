import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { getSession } from "@/lib/auth/session";
import { listNotifications } from "@/lib/db/notifications";
import type { NotificationListResult } from "@/lib/types";
import { notificationListLimitSchema } from "@/lib/validation/notifications";

export const runtime = "nodejs";

export const GET = withApiHandler<NotificationListResult>(
  "GET /api/notifications",
  async (request) => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    // Recipient is the session id; there is no query parameter for it.
    const limit = notificationListLimitSchema.parse(
      request.nextUrl.searchParams.get("limit") ?? undefined,
    );

    return listNotifications(session.id, { limit });
  },
);

import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { getSession } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/db/notifications";

export const runtime = "nodejs";

export const POST = withApiHandler<{ updated: number }>(
  "POST /api/notifications/read-all",
  async () => {
    const session = await getSession();

    if (!session) {
      throw AppError.unauthenticated();
    }

    return { updated: await markAllNotificationsRead(session.id) };
  },
);

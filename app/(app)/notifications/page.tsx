import { Bell } from "lucide-react";

import { NotificationList } from "@/components/domain/notification-list";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { listNotifications } from "@/lib/db/notifications";
import type { NotificationListResult } from "@/lib/types";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const session = await requireSession();

  let databaseUnavailable = false;
  let data: NotificationListResult = { items: [], unreadCount: 0 };

  try {
    data = await listNotifications(session.id);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.DATABASE_NOT_CONFIGURED) {
      databaseUnavailable = true;
    } else {
      throw error;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your workspace"
        title="Notifications"
        description="Submission and decision updates addressed to you, newest first."
      />

      {databaseUnavailable ? (
        <Alert variant="warning" title="Database not configured">
          <div className="space-y-2">
            <p>
              Notifications need Postgres. Set <code className="font-mono">DATABASE_URL</code> in{" "}
              <code className="font-mono">.env.local</code>, then run:
            </p>
            <p className="text-caption font-mono">npm run db:migrate && npm run db:seed</p>
          </div>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell aria-hidden="true" className="size-5" />
              Inbox
            </CardTitle>
            <CardDescription>
              Email copies are delivered by the notification job; they are not shown here.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <NotificationList items={data.items} unreadCount={data.unreadCount} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

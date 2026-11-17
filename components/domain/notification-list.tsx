"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { NotificationItem } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export interface NotificationListProps {
  items: NotificationItem[];
  unreadCount: number;
}

/**
 * Only the read interactions need client state; the list itself is server
 * rendered and refreshed with `router.refresh()` after each mutation.
 */
export function NotificationList({ items, unreadCount }: NotificationListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function markRead(id: string) {
    setBusyId(id);
    setError(null);

    const response = await fetch(`/api/notifications/${id}/read`, { method: "POST" });

    setBusyId(null);

    if (!response.ok) {
      setError("That notification could not be marked as read. Try again.");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function markAllRead() {
    setError(null);

    const response = await fetch("/api/notifications/read-all", { method: "POST" });

    if (!response.ok) {
      setError("Notifications could not be marked as read. Try again.");
      return;
    }

    startTransition(() => router.refresh());
  }

  if (items.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="When a request is submitted or decided, the notification appears here."
        />
      </div>
    );
  }

  return (
    <div>
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <p className="text-caption text-muted-foreground">
          {unreadCount === 0 ? "You are all caught up." : `${unreadCount} unread`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={markAllRead}
          disabled={isPending || unreadCount === 0}
        >
          <CheckCheck aria-hidden="true" />
          Mark all read
        </Button>
      </div>

      {error ? (
        <div className="px-5 pt-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      ) : null}

      <ul className="divide-border divide-y">
        {items.map((item) => {
          const unread = item.readAt === null;

          return (
            <li
              key={item.id}
              className={cn("flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:gap-4")}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {unread ? <Badge variant="primary">New</Badge> : null}
                  <p className="text-small text-foreground font-semibold">{item.subject}</p>
                </div>
                <p className="text-small text-muted-foreground">{item.body}</p>
                <div className="text-caption text-muted-foreground flex flex-wrap items-center gap-3">
                  <span>{formatDateTime(item.createdAt)}</span>
                  <Link
                    href={`/requests/${item.leaveRequestId}`}
                    className="text-primary font-semibold hover:underline"
                  >
                    View request
                  </Link>
                </div>
              </div>
              {unread ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => markRead(item.id)}
                  disabled={isPending || busyId === item.id}
                  className="shrink-0 self-start"
                >
                  Mark read
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

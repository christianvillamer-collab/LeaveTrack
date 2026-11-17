import type { NotificationEventType } from "@/lib/types";
import { formatDateRange, formatDays } from "@/lib/utils/format";

export interface NotificationCopyInput {
  eventType: NotificationEventType;
  /** The person the request belongs to. */
  employeeName: string;
  /** The person who caused the event (submitter, manager, or HR). */
  actorName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string | null;
  note?: string | null;
  isOverride?: boolean;
}

export interface NotificationCopy {
  subject: string;
  body: string;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

/**
 * Pure copy builder. Both channels share one message per event so the in-app
 * row and the email can never disagree; keep the acceptance-criteria wording
 * here rather than in the DB layer.
 */
export function buildNotificationCopy(input: NotificationCopyInput): NotificationCopy {
  const range = formatDateRange(input.startDate, input.endDate);
  const duration = formatDays(input.days);

  if (input.eventType === "request_submitted") {
    const reason = input.reason?.trim();

    return {
      subject: `${input.employeeName} requested ${input.leaveTypeName} leave`,
      body: reason
        ? `${input.employeeName} submitted a ${input.leaveTypeName} leave request for ${range} (${duration}). Reason: ${sentence(reason)}`
        : `${input.employeeName} submitted a ${input.leaveTypeName} leave request for ${range} (${duration}).`,
    };
  }

  const byWhom = input.isOverride ? `HR (${input.actorName})` : input.actorName;

  if (input.eventType === "request_approved") {
    return {
      subject: `Your ${input.leaveTypeName} request was approved`,
      body: input.isOverride
        ? `Your ${input.leaveTypeName} request for ${range} (${duration}) was approved by ${byWhom} as an override.${input.note ? ` ${sentence(input.note)}` : ""}`
        : `Your ${input.leaveTypeName} request for ${range} (${duration}) was approved by ${byWhom}.`,
    };
  }

  return {
    subject: `Your ${input.leaveTypeName} request was rejected`,
    body: `Your ${input.leaveTypeName} request for ${range} (${duration}) was rejected by ${byWhom}.${input.note ? ` ${sentence(input.note)}` : ""}`,
  };
}

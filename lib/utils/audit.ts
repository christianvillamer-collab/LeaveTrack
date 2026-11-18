import type { AuditEvent } from "@/lib/types";
import { formatDateTime } from "@/lib/utils/format";

/** Display-ready action label shared by the badge and the CSV export. */
export function actionLabel(action: AuditEvent["action"]): string {
  if (action === "hr_override_approved") return "HR override approved";
  if (action === "hr_override_rejected") return "HR override rejected";
  if (action === "submitted") return "Submitted";
  if (action === "approved") return "Approved";
  return "Rejected";
}

/** Column order mirrors the on-screen table so the CSV is a faithful export. */
export const AUDIT_CSV_HEADERS = [
  "Occurred",
  "Employee",
  "Request",
  "Action",
  "Recorded by",
  "Detail",
] as const;

/** One CSV row in the same order as the on-screen table. */
export function auditEventToCsvRow(event: AuditEvent): string[] {
  return [
    formatDateTime(event.occurredAt),
    event.employee.name,
    event.requestReference,
    actionLabel(event.action),
    event.actor.name,
    event.detail,
  ];
}

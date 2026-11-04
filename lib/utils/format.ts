import { differenceInCalendarDays, format, parseISO } from "date-fns";

export function formatDate(isoDate: string): string {
  return format(parseISO(isoDate), "d MMM yyyy");
}

export function formatDateTime(isoDate: string): string {
  return format(parseISO(isoDate), "d MMM yyyy, HH:mm");
}

export function formatDateRange(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth && start.getDate() === end.getDate()) {
    return format(start, "d MMM yyyy");
  }

  if (sameMonth) {
    return `${format(start, "d")}–${format(end, "d MMM yyyy")}`;
  }

  if (sameYear) {
    return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  }

  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

/** Inclusive calendar-day count — the same rule enforced by the DB CHECK. */
export function countLeaveDays(startDate: string, endDate: string): number {
  return differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
}

/**
 * Stable display reference for a leave request. `leave_requests` has no
 * reference column, so audit surfaces derive one from the UUID instead of
 * inventing a schema field. The trailing hex is used because seeded UUIDs share
 * a leading segment (`b0000000-…`), which would make references collide.
 */
export function formatRequestReference(id: string): string {
  return `LR-${id.replace(/-/g, "").slice(-8).toUpperCase()}`;
}

export function formatDays(value: number): string {
  return `${value.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2,
  })} ${value === 1 ? "day" : "days"}`;
}

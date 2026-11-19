import { differenceInCalendarDays, format, parseISO } from "date-fns";

// Instants are rendered in UTC on both the server and the browser. Local-time
// formatting produces different text during SSR and hydration (React #418).
const utcDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDate(isoDate: string): string {
  return format(parseISO(isoDate), "d MMM yyyy");
}

export function formatDateTime(isoDate: string): string {
  return utcDateTime.format(parseISO(isoDate));
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
 * Display reference stored on `leave_requests`. The database generates the
 * value (existing rows were backfilled with their former UUID-derived value),
 * so this is a pass-through: identity is never inferred from the request UUID.
 */
export function formatRequestReference(reference: string): string {
  return reference;
}

export function formatDays(value: number): string {
  return `${value.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2,
  })} ${value === 1 ? "day" : "days"}`;
}

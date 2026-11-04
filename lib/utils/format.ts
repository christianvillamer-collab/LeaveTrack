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

export function formatDays(value: number): string {
  return `${value.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2,
  })} ${value === 1 ? "day" : "days"}`;
}

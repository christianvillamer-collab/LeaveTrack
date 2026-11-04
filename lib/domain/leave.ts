import { formatDays } from "@/lib/utils/format";
import type { LeaveRequestWarning } from "@/lib/types";

export interface BalanceWarningInput {
  tracksBalance: boolean;
  requestedDays: number;
  availableDays: number | null;
}

/**
 * Over-balance is advisory only (US-01 AC3). Unpaid leave is never
 * balance-limited; a tracked type without a balance row is treated as 0.
 */
export function evaluateBalanceWarning({
  tracksBalance,
  requestedDays,
  availableDays,
}: BalanceWarningInput): LeaveRequestWarning {
  if (!tracksBalance) {
    return {
      exceedsBalance: false,
      requestedDays,
      availableDays: null,
      message: null,
    };
  }

  const available = availableDays ?? 0;
  const exceedsBalance = requestedDays > available;

  return {
    exceedsBalance,
    requestedDays,
    availableDays: available,
    message: exceedsBalance
      ? `This request is ${formatDays(requestedDays)}; your confirmed balance is ${formatDays(available)}. You can still submit it for HR override.`
      : null,
  };
}

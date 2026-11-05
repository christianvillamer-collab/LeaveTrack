const ACCRUAL_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/**
 * Accrual periods are the UTC calendar month, normalized to its first day.
 * Keeping the conversion pure and UTC-only means the route, the ledger rows,
 * and the tests cannot disagree because of the host timezone.
 */
export function accrualPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return `${year}-${month}-01`;
}

export function isAccrualPeriod(value: string): boolean {
  return ACCRUAL_PERIOD_PATTERN.test(value);
}

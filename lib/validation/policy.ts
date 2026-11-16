import { z } from "zod";

const atMostTwoDecimals = (value: number) => /^\d+(\.\d{1,2})?$/.test(String(value));

/**
 * HR policy update. `effectiveFrom` is the first day of an accrual month: the
 * rate applies to that month and every later month, never to a past period. The
 * actor is resolved from the session, so a client-supplied one is rejected by
 * `.strict()`.
 */
export const policyRateInputSchema = z
  .object({
    userId: z.uuid("Select a valid employee."),
    leaveTypeId: z.uuid("Select a valid leave type."),
    accrualPerMonth: z
      .number("Enter the monthly accrual rate as a number.")
      .min(0, "Monthly accrual cannot be negative.")
      .max(31, "Monthly accrual cannot exceed 31 days.")
      .refine(atMostTwoDecimals, "Use at most two decimal places."),
    effectiveFrom: z.iso
      .date("Enter a valid effective month.")
      .refine((value) => value.endsWith("-01"), {
        message: "The effective month must be the first day of the month.",
      }),
  })
  .strict();

export type PolicyRateInput = z.infer<typeof policyRateInputSchema>;

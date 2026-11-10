import { z } from "zod";

export const leaveRequestInputSchema = z
  .object({
    leaveTypeId: z.uuid("Select a valid leave type."),
    startDate: z.iso.date("Enter a valid start date."),
    endDate: z.iso.date("Enter a valid end date."),
    reason: z
      .string()
      .trim()
      .min(5, "Give your manager at least a short reason.")
      .max(2000, "Reason must be 2,000 characters or fewer."),
  })
  .strict()
  .refine((value) => value.endDate >= value.startDate, {
    message: "End date cannot be before the start date.",
    path: ["endDate"],
  });

export type LeaveRequestInput = z.infer<typeof leaveRequestInputSchema>;

/** Path ids are UUIDs; anything else should 404 before it reaches Postgres. */
export const leaveRequestIdSchema = z.uuid("The request id is invalid.");

export const leaveRequestScopeSchema = z
  .enum(["mine", "team"], {
    message: 'scope must be "mine" or "team".',
  })
  .default("mine");

export type LeaveRequestScope = z.infer<typeof leaveRequestScopeSchema>;

export const decisionInputSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "rejected" && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A rejection reason is required.",
      });
    }
  });

export type DecisionInput = z.infer<typeof decisionInputSchema>;

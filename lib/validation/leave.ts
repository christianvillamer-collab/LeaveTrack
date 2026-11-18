import { z } from "zod";

import { listQuerySchema } from "@/lib/validation/list";

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

/** Query contract shared by `GET /api/leave-requests` and `/requests`. */
export const leaveRequestListQuerySchema = listQuerySchema.extend({
  scope: leaveRequestScopeSchema,
});

export type LeaveRequestListQuery = z.infer<typeof leaveRequestListQuerySchema>;

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

/**
 * HR cross-team override. The explicit `override: true` flag is what makes the
 * action auditable as an override, and a reason is required for approvals and
 * rejections alike.
 */
export const overrideInputSchema = z
  .object({
    override: z.literal(true),
    decision: z.enum(["approved", "rejected"]),
    reason: z
      .string()
      .trim()
      .min(3, "Give a short reason for the override.")
      .max(2000, "Reason must be 2,000 characters or fewer."),
  })
  .strict();

export type OverrideInput = z.infer<typeof overrideInputSchema>;

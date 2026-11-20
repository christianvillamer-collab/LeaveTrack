import { z } from "zod";

const personName = z
  .string("Enter the person's name.")
  .trim()
  .min(1, "Enter the person's name.")
  .max(120, "Keep the name to 120 characters or fewer.");

/**
 * Trim before validating so a pasted address with stray spaces is accepted and
 * stored without them. `z.email()` alone checks the raw string.
 */
function emailField(message: string) {
  return z
    .string()
    .trim()
    .max(254, "Keep the email address to 254 characters or fewer.")
    .pipe(z.email(message));
}

const personEmail = emailField("Enter a valid email address.");

const profileText = z
  .string()
  .trim()
  .max(120, "Keep this field to 120 characters or fewer.")
  .nullable()
  .transform((value) => (value === null || value.length === 0 ? null : value));

/**
 * Import keeps a three-state contract: an omitted key leaves the stored value
 * alone, `null` or an empty string clears it, and a value replaces it. Collapsing
 * `undefined` into `null` here would let a partial row wipe a reporting line.
 */
const optionalImportText = z
  .string()
  .trim()
  .max(120, "Keep this field to 120 characters or fewer.")
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    return value === null || value.length === 0 ? null : value;
  });

export const personIdSchema = z.uuid("Select a valid employee record.");

/** HR single-user create (E2-23). Role is an initial value, not a role editor. */
export const personCreateSchema = z
  .object({
    name: personName,
    email: personEmail,
    role: z.enum(["employee", "manager", "hr_admin"]),
    managerEmail: emailField("Enter a valid manager email address.").nullable().optional(),
    jobTitle: profileText.optional(),
    team: profileText.optional(),
  })
  .strict();

/** HR profile edit. The actor is resolved from the session, never the body. */
export const personProfileSchema = z
  .object({
    name: personName,
    email: personEmail,
    jobTitle: profileText,
    team: profileText,
  })
  .strict();

export const managerAssignmentSchema = z
  .object({
    managerId: z.uuid("Select a valid manager.").nullable(),
  })
  .strict();

/**
 * Deactivation requires a 3–2000 character reason. Reactivation has no reason
 * requirement; `setPersonActive` discards a reason if one is sent anyway.
 */
export const personStatusSchema = z
  .object({
    isActive: z.boolean("Choose whether the account is active."),
    reason: z.string().trim().max(2000, "Keep the reason to 2000 characters or fewer.").optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.isActive) {
      return;
    }

    if (!value.reason || value.reason.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Give a reason of at least 3 characters for deactivation.",
      });
    }
  });

const importRowSchema = z
  .object({
    name: personName,
    email: personEmail,
    role: z.enum(["employee", "manager", "hr_admin"]).optional(),
    managerEmail: emailField("Enter a valid manager email address.").nullable().optional(),
    jobTitle: optionalImportText,
    team: optionalImportText,
  })
  .strict();

/**
 * Bulk import is a JSON array, capped so one request cannot hold a transaction
 * open indefinitely. Duplicate emails inside the batch are rejected before any
 * SQL runs; existing emails are idempotent no-ops when nothing changed.
 */
export const peopleImportSchema = z
  .array(importRowSchema)
  .min(1, "Add at least one person to import.")
  .max(200, "Import at most 200 people per request.")
  .superRefine((rows, ctx) => {
    const seen = new Map<string, number>();

    rows.forEach((row, index) => {
      const key = row.email.trim().toLowerCase();
      const first = seen.get(key);

      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [index, "email"],
          message: `The same email appears more than once (first at row ${first + 1}).`,
        });
      } else {
        seen.set(key, index);
      }
    });
  });

export type PersonCreateInput = z.infer<typeof personCreateSchema>;
export type PersonProfileInput = z.infer<typeof personProfileSchema>;
export type ManagerAssignmentInput = z.infer<typeof managerAssignmentSchema>;
export type PersonStatusInput = z.infer<typeof personStatusSchema>;
export type PeopleImportInput = z.infer<typeof peopleImportSchema>;

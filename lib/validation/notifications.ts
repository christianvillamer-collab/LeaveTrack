import { z } from "zod";

/** Path ids are UUIDs; anything else should 404 before it reaches Postgres. */
export const notificationIdSchema = z.uuid("The notification id is invalid.");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * `?limit=` is a single optional query value, not a body. Anything that is not
 * a whole number in range is rejected rather than silently clamped, so a typo
 * in a client call is visible.
 */
export const notificationListLimitSchema = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === "" ? DEFAULT_LIMIT : Number(value)))
  .refine(
    (value) => Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT,
    `limit must be a whole number between 1 and ${MAX_LIMIT}.`,
  );

export type NotificationListLimit = z.infer<typeof notificationListLimitSchema>;

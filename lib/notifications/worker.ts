import "server-only";

import { claimPendingEmails, MAX_EMAIL_ATTEMPTS, recordEmailResult } from "@/lib/db/notifications";
import { logger } from "@/lib/logging/logger";
import {
  EmailNotConfiguredError,
  resolveEmailTransport,
  type EmailTransport,
} from "@/lib/notifications/email";
import type { NotificationJobResult } from "@/lib/types";

/**
 * Drains one batch of the email outbox. Delivery happens outside any database
 * transaction: rows are leased first, then each attempt is recorded on its own.
 * A single bad address fails only its row.
 */
export async function runNotificationOutbox(
  transport: EmailTransport = resolveEmailTransport(),
): Promise<NotificationJobResult> {
  const batch = await claimPendingEmails();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of batch) {
    try {
      await transport.send({
        to: row.recipientEmail,
        subject: row.subject,
        text: row.body,
        html: row.htmlBody ?? undefined,
      });

      await recordEmailResult(row.id, { ok: true });
      sent += 1;
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) {
        await recordEmailResult(row.id, { ok: false, skipped: true, error: error.message });
        skipped += 1;
        continue;
      }

      await recordEmailResult(row.id, {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown delivery error.",
      });
      failed += 1;
      logger.warn({ notificationId: row.id }, "notifications.email_failed");
    }
  }

  logger.info(
    { processed: batch.length, sent, failed, skipped, maxAttempts: MAX_EMAIL_ATTEMPTS },
    "notifications.outbox_drained",
  );

  return { processed: batch.length, sent, failed, skipped };
}

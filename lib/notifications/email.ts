import "server-only";

import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Raised when the configured provider is missing its credentials. */
export class EmailNotConfiguredError extends Error {
  constructor(message = "Email transport is not configured.") {
    super(message);
    this.name = "EmailNotConfiguredError";
  }
}

/**
 * Development/demo transport. It reports success without contacting anyone, so
 * the outbox drains and the UI stays coherent with an empty environment.
 * Nothing recipient-identifying is logged.
 */
const logTransport: EmailTransport = {
  name: "log",
  async send() {
    logger.info({ transport: "log" }, "notifications.email_logged");
  },
};

/**
 * Dependency-free Resend transport. The API key and sender stay server-side;
 * the adapter is the only place that talks to a provider.
 */
const resendTransport: EmailTransport = {
  name: "resend",
  async send(message) {
    const { EMAIL_API_KEY, EMAIL_FROM } = env();

    if (!EMAIL_API_KEY || !EMAIL_FROM) {
      throw new EmailNotConfiguredError(
        "EMAIL_TRANSPORT=resend requires EMAIL_API_KEY and EMAIL_FROM.",
      );
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `The email provider rejected the message (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
  },
};

/** Resolved at call time so tests can substitute a fake transport. */
export function resolveEmailTransport(): EmailTransport {
  return env().EMAIL_TRANSPORT === "resend" ? resendTransport : logTransport;
}

import pino from "pino";

import { env } from "@/lib/config/env";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "password",
  "token",
  "secret",
  "*.password",
  "*.token",
  "*.secret",
];

export const logger = pino({
  level: env().LOG_LEVEL,
  base: {
    service: "leavetrack",
    env: env().NODE_ENV,
  },
  redact: {
    paths: REDACT_PATHS,
    censor: "[redacted]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function requestLogger(requestId: string, route: string) {
  return logger.child({ requestId, route });
}

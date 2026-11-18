import { appUrl } from "@/lib/config/env";
import { buildNotificationCopy, type NotificationCopyInput } from "@/lib/notifications/templates";
import { formatDateRange, formatDays } from "@/lib/utils/format";

/**
 * Visual email design for the three LeaveTrack events. The subject and body
 * still come from `buildNotificationCopy`, so in-app and email copy cannot
 * drift; this module only wraps that copy in a client-safe layout.
 *
 * Email clients do not reliably support CSS custom properties, grid, or HSL,
 * so the design uses table layout, inline styles, and hex equivalents of the
 * Evergreen HSL tokens. This is the deliberate exception to the CSS rule in
 * `knowledge/design-system.md`, which governs `app/globals.css`.
 */

interface EventTheme {
  label: string;
  title: string;
  banner: string;
  border: string;
  ink: string;
  accent: string;
}

const THEMES: Record<NotificationCopyInput["eventType"], EventTheme> = {
  // warning token: hsl(35 92% 40%) / hsl(45 100% 96%)
  request_submitted: {
    label: "PENDING REVIEW",
    title: "A new leave request needs your review",
    banner: "#fff6e9",
    border: "#f3d4a8",
    ink: "#8a4d05",
    accent: "#c4700c",
  },
  // success token: hsl(152 60% 32%) / hsl(150 60% 95%)
  request_approved: {
    label: "APPROVED",
    title: "Your leave request was approved",
    banner: "#e9f6ee",
    border: "#bfe3cd",
    ink: "#155e3d",
    accent: "#208455",
  },
  // danger token: hsl(0 72% 45%) / hsl(0 86% 97%)
  request_rejected: {
    label: "REJECTED",
    title: "Your leave request was rejected",
    banner: "#fdecec",
    border: "#f3c5c5",
    ink: "#8f1f1f",
    accent: "#c52828",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function detailRow(label: string, value: string): string {
  return `
        <tr>
          <td style="padding:10px 16px;color:#626d7d;font:14px/20px Inter,Arial,sans-serif;">${escapeHtml(label)}</td>
          <td style="padding:10px 16px;color:#1c2430;font:600 14px/20px Inter,Arial,sans-serif;text-align:right;">${escapeHtml(value)}</td>
        </tr>`;
}

export interface NotificationEmail {
  subject: string;
  body: string;
  html: string;
}

/** Subject, plain text, and designed HTML from one immutable input. */
export function buildNotificationEmail(input: NotificationCopyInput): NotificationEmail {
  const copy = buildNotificationCopy(input);
  const theme = THEMES[input.eventType];
  const isSubmission = input.eventType === "request_submitted";
  const baseUrl = appUrl().replace(/\/$/, "");
  const href = `${baseUrl}${isSubmission ? "/approvals" : "/requests"}`;
  const ctaLabel = isSubmission ? "Review request" : "View your request";
  const range = formatDateRange(input.startDate, input.endDate);
  const duration = formatDays(input.days);
  const note = isSubmission ? input.reason : input.note;
  const noteLabel = isSubmission
    ? "Reason"
    : input.isOverride
      ? "HR override reason"
      : "Manager note";

  const noteRow = note?.trim() ? detailRow(noteLabel, note.trim()) : "";

  // Email clients show the first visible text as a preview. Keep it short so a
  // long reason cannot dominate the preview or duplicate the full message.
  const preheader = copy.body.length > 160 ? `${copy.body.slice(0, 157)}…` : copy.body;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ec;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ec;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #ccd3dc;border-radius:14px;">
          <tr>
            <td style="background:#152925;padding:20px 28px;border-radius:13px 13px 0 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="34" height="34" style="width:34px;height:34px;background:#2a8d74;border-radius:8px;color:#ffffff;font:700 18px/34px Inter,Arial,sans-serif;text-align:center;">L</td>
                  <td style="padding-left:10px;">
                    <div style="color:#ffffff;font:600 17px/20px Inter,Arial,sans-serif;">LeaveTrack</div>
                    <div style="color:#a9c6bd;font:12px/16px Inter,Arial,sans-serif;">People Operations</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 4px;">
              <span style="display:inline-block;background:${theme.banner};border:1px solid ${theme.border};border-radius:999px;padding:6px 12px;color:${theme.ink};font:700 11px/16px Inter,Arial,sans-serif;letter-spacing:0.08em;">${escapeHtml(theme.label)}</span>
              <h1 style="margin:16px 0 8px;color:#1c2430;font:600 24px/32px Inter,Arial,sans-serif;">${escapeHtml(theme.title)}</h1>
              <p style="margin:0 0 12px;color:#626d7d;font:14px/22px Inter,Arial,sans-serif;">Hello,</p>
              <p style="margin:0;color:#1c2430;font:400 15px/24px Inter,Arial,sans-serif;">${escapeHtml(copy.body)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #ccd3dc;border-radius:10px;background:#f7f5f1;">
                ${detailRow("Employee", input.employeeName)}
                ${detailRow("Leave type", input.leaveTypeName)}
                ${detailRow("Dates", range)}
                ${detailRow("Duration", duration)}${noteRow}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 28px;">
              <a href="${escapeHtml(href)}" style="display:inline-block;background:#116b59;color:#ffffff;border-radius:10px;padding:12px 20px;font:600 14px/20px Inter,Arial,sans-serif;text-decoration:none;">${escapeHtml(ctaLabel)}</a>
              <p style="margin:14px 0 0;color:#626d7d;font:12px/18px Inter,Arial,sans-serif;">If the button does not work, paste this link into your browser:<br><a href="${escapeHtml(href)}" style="color:${theme.accent};">${escapeHtml(href)}</a></p>
            </td>
          </tr>
          <tr>
            <td style="background:#f7f5f1;border-top:1px solid #ccd3dc;border-radius:0 0 13px 13px;padding:18px 28px;color:#626d7d;font:12px/18px Inter,Arial,sans-serif;">
              You received this email because a LeaveTrack leave request involved you.<br>
              LeaveTrack &middot; People Operations
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: copy.subject, body: copy.body, html };
}

import { notFound } from "next/navigation";

import { buildNotificationEmail } from "@/lib/notifications/email-template";
import type { NotificationCopyInput } from "@/lib/notifications/templates";

export const runtime = "nodejs";

const examples: { label: string; recipient: string; input: NotificationCopyInput }[] = [
  {
    label: "Pending — manager review",
    recipient: "Manager",
    input: {
      eventType: "request_submitted",
      employeeName: "CV Test Employee",
      actorName: "CV Test Employee",
      leaveTypeName: "Vacation",
      startDate: "2026-12-14",
      endDate: "2026-12-15",
      days: 2,
      reason: "Approval retest after DB pooler fix.",
    },
  },
  {
    label: "Approved — requestor notice",
    recipient: "Requestor",
    input: {
      eventType: "request_approved",
      employeeName: "CV Test Employee",
      actorName: "Christian Villamer",
      leaveTypeName: "Vacation",
      startDate: "2026-12-14",
      endDate: "2026-12-15",
      days: 2,
    },
  },
  {
    label: "Rejected — requestor notice",
    recipient: "Requestor",
    input: {
      eventType: "request_rejected",
      employeeName: "CV Test Employee",
      actorName: "Christian Villamer",
      leaveTypeName: "Vacation",
      startDate: "2026-12-21",
      endDate: "2026-12-22",
      days: 2,
      note: "Pooler fix retest; please resubmit after confirming coverage.",
    },
  },
];

/** Dev-only visual review of the three transactional email designs. */
export default function EmailDesignPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-[900px] px-6 py-10">
      <h1 className="text-h2 text-foreground font-semibold">Email notification designs</h1>
      <p className="text-small text-muted-foreground mt-2">
        Rendered from the same copy builder used by the outbox. Development only.
      </p>

      <div className="mt-8 space-y-10">
        {examples.map((example) => {
          const email = buildNotificationEmail(example.input);

          return (
            <section key={example.label}>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-h3 text-foreground font-semibold">{example.label}</h2>
                <span className="text-caption text-muted-foreground">
                  To: {example.recipient} · Subject: {email.subject}
                </span>
              </div>
              <iframe
                title={example.label}
                srcDoc={email.html}
                sandbox=""
                className="border-border bg-card h-[780px] w-full rounded-lg border"
              />
            </section>
          );
        })}
      </div>
    </main>
  );
}

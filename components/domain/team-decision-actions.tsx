"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { TeamLeaveRequest } from "@/lib/types";
import { formatDateRange, formatDays } from "@/lib/utils/format";

export interface TeamDecisionActionsProps {
  request: TeamLeaveRequest;
}

type Decision = "approved" | "rejected";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || payload.success !== false || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.message === "string" ? payload.error.message : null;
}

export function TeamDecisionActions({ request }: TeamDecisionActionsProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openDecision(nextDecision: Decision) {
    setDecision(nextDecision);
    setReason("");
    setReasonError(null);
    setError(null);
  }

  function closeDecision() {
    if (submitting) {
      return;
    }

    setDecision(null);
    setReason("");
    setReasonError(null);
    setError(null);
  }

  async function confirmDecision() {
    if (!decision) {
      return;
    }

    if (decision === "rejected" && reason.trim().length < 3) {
      setReasonError("Give the employee a short reason for the rejection.");
      return;
    }

    setSubmitting(true);
    setReasonError(null);
    setError(null);

    try {
      const response = await fetch(`/api/leave-requests/${request.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: reason.trim() || undefined,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(getApiErrorMessage(payload) ?? "The decision could not be recorded. Try again.");
        return;
      }

      setDecision(null);
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => openDecision("approved")}
          aria-label={`Approve ${request.employee.name}'s ${request.leaveType.name} request`}
        >
          <Check aria-hidden="true" />
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => openDecision("rejected")}
          aria-label={`Reject ${request.employee.name}'s ${request.leaveType.name} request`}
        >
          <X aria-hidden="true" />
          Reject
        </Button>
      </div>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDecision();
          }
        }}
        title={decision === "rejected" ? "Reject this request?" : "Approve this request?"}
        description={`${request.employee.name} · ${formatDateRange(request.startDate, request.endDate)} · ${formatDays(request.days)}`}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDecision} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={decision === "rejected" ? "danger" : "primary"}
              loading={submitting}
              loadingText="Saving…"
              onClick={confirmDecision}
            >
              {decision === "rejected" ? "Confirm rejection" : "Confirm approval"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="bg-surface-muted text-foreground text-small rounded-md p-3">
            {request.reason}
          </p>

          {decision === "rejected" ? (
            <Field
              id="decision-reason"
              label="Rejection reason"
              hint="The employee and HR can see this."
              error={reasonError ?? undefined}
              required
            >
              {({ id, describedBy, invalid, required }) => (
                <Textarea
                  id={id}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(null);
                  }}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  required={required}
                />
              )}
            </Field>
          ) : (
            <Alert variant="info" title="Balance impact">
              {request.leaveType.tracksBalance
                ? `Approving deducts ${formatDays(request.days)} from ${request.employee.name}'s ${request.leaveType.name} balance.`
                : "Unpaid leave has no balance to deduct."}
            </Alert>
          )}

          {error ? <Alert variant="danger">{error}</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}

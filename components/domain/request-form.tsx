"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Info, Send } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { evaluateBalanceWarning } from "@/lib/domain/leave";
import type { CreateLeaveRequestResult, LeaveType } from "@/lib/types";
import { countLeaveDays, formatDateRange, formatDays } from "@/lib/utils/format";

export interface RequestFormProps {
  leaveTypes: LeaveType[];
  defaultLeaveTypeId?: string;
  balanceSummary?: { leaveTypeId: string; available: number | null }[];
}

interface FormErrors {
  leaveTypeId?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuccessPayload(
  payload: unknown,
): payload is { success: true; data: CreateLeaveRequestResult } {
  return isRecord(payload) && payload.success === true && isRecord(payload.data);
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || payload.success !== false || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.message === "string" ? payload.error.message : null;
}

export function RequestForm({
  leaveTypes,
  defaultLeaveTypeId,
  balanceSummary = [],
}: RequestFormProps) {
  const router = useRouter();
  const [errors, setErrors] = useState<FormErrors>({});
  const [leaveTypeId, setLeaveTypeId] = useState(defaultLeaveTypeId ?? leaveTypes[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateLeaveRequestResult | null>(null);

  const selectedType = leaveTypes.find((type) => type.id === leaveTypeId);
  const selectedBalance = balanceSummary.find((entry) => entry.leaveTypeId === leaveTypeId);
  const requestedDays =
    startDate && endDate && endDate >= startDate ? countLeaveDays(startDate, endDate) : 0;
  const clientWarningResult = evaluateBalanceWarning({
    tracksBalance: selectedType?.tracksBalance ?? false,
    requestedDays,
    availableDays: selectedBalance?.available ?? null,
  });
  const clientWarning = clientWarningResult.exceedsBalance ? clientWarningResult.message : null;

  function clearFeedback() {
    setResult(null);
    setServerError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();

    const form = event.currentTarget;
    const data = new FormData(form);
    const reason = String(data.get("reason") ?? "").trim();
    const nextErrors: FormErrors = {};

    if (!leaveTypeId) {
      nextErrors.leaveTypeId = "Select a leave type.";
    }

    if (!startDate) {
      nextErrors.startDate = "Choose a start date.";
    }

    if (!endDate) {
      nextErrors.endDate = "Choose an end date.";
    }

    if (startDate && endDate && endDate < startDate) {
      nextErrors.endDate = "End date cannot be before the start date.";
    }

    if (reason.length < 5) {
      nextErrors.reason = "Give your manager at least a short reason.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstField = Object.keys(nextErrors)[0];
      const field = form.elements.namedItem(firstField);
      if (field instanceof HTMLElement) {
        field.focus();
      }
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      const response = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveTypeId, startDate, endDate, reason }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok || !isSuccessPayload(payload)) {
        setServerError(
          getApiErrorMessage(payload) ??
            "The request could not be submitted. Check the form and try again.",
        );
        return;
      }

      setResult(payload.data);
      router.refresh();
    } catch {
      setServerError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-5"
      aria-describedby="request-form-note"
    >
      <Alert variant="info" id="request-form-note">
        Your request is saved as pending for manager review. Over-balance requests are accepted and
        flagged for HR override.
      </Alert>

      <Field id="leaveTypeId" label="Leave type" error={errors.leaveTypeId} required>
        {({ id, describedBy, invalid, required }) => (
          <Select
            id={id}
            name="leaveTypeId"
            value={leaveTypeId}
            onChange={(event) => {
              setLeaveTypeId(event.target.value);
              clearFeedback();
            }}
            aria-describedby={describedBy}
            invalid={invalid}
            required={required}
          >
            {leaveTypes.map((type) => {
              const balance = balanceSummary.find((entry) => entry.leaveTypeId === type.id);
              const suffix =
                balance?.available === null || balance?.available === undefined
                  ? "no balance limit"
                  : `${formatDays(balance.available)} available`;
              return (
                <option key={type.id} value={type.id}>
                  {type.name} — {suffix}
                </option>
              );
            })}
          </Select>
        )}
      </Field>

      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <Field
          id="startDate"
          label="Start date"
          error={errors.startDate}
          required
          className="min-w-0"
        >
          {({ id, describedBy, invalid, required }) => (
            <div className="relative">
              <CalendarDays
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              />
              <Input
                id={id}
                name="startDate"
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  clearFeedback();
                }}
                aria-describedby={describedBy}
                invalid={invalid}
                required={required}
                className="pl-9"
              />
            </div>
          )}
        </Field>

        <Field id="endDate" label="End date" error={errors.endDate} required className="min-w-0">
          {({ id, describedBy, invalid, required }) => (
            <div className="relative">
              <CalendarDays
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              />
              <Input
                id={id}
                name="endDate"
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  clearFeedback();
                }}
                aria-describedby={describedBy}
                invalid={invalid}
                required={required}
                className="pl-9"
              />
            </div>
          )}
        </Field>
      </div>

      <Field
        id="reason"
        label="Reason"
        hint="Your manager and HR can see this. Up to 2,000 characters."
        error={errors.reason}
        required
      >
        {({ id, describedBy, invalid, required }) => (
          <Textarea
            id={id}
            name="reason"
            rows={4}
            placeholder="Share enough context for your manager to decide, plus any handover notes."
            onChange={clearFeedback}
            aria-describedby={describedBy}
            invalid={invalid}
            required={required}
          />
        )}
      </Field>

      {clientWarning && !result ? (
        <Alert variant="warning" title="Over your confirmed balance">
          {clientWarning}
        </Alert>
      ) : null}

      {result ? (
        <Alert variant="success" title="Request submitted">
          Your {result.request.leaveType.name} request for{" "}
          {formatDateRange(result.request.startDate, result.request.endDate)} (
          {formatDays(result.request.days)}) is pending{" "}
          {result.managerNotified
            ? "your manager's review"
            : "HR review — no manager is assigned to this account"}
          .
        </Alert>
      ) : null}

      {result?.warning.exceedsBalance && result.warning.message ? (
        <Alert variant="warning" title="Over-balance warning">
          {result.warning.message}
        </Alert>
      ) : null}

      {serverError ? <Alert variant="danger">{serverError}</Alert> : null}

      <div className="border-border flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
        <Button asChild variant="secondary">
          <Link href="/requests">Cancel</Link>
        </Button>
        <Button type="submit" loading={submitting} loadingText="Submitting…">
          <Send aria-hidden="true" />
          Submit request
        </Button>
      </div>

      <p className="text-caption text-muted-foreground flex items-start gap-2">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Dates are inclusive. Pending requests do not reduce your confirmed balance until a manager
        approves them.
      </p>
    </form>
  );
}

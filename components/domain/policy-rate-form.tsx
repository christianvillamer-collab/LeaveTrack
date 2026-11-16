"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Save } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { LeaveType, PolicyRateResult } from "@/lib/types";
import { formatDate, formatDays } from "@/lib/utils/format";

export interface PolicyRateFormProps {
  employees: { id: string; name: string; email: string }[];
  leaveTypes: LeaveType[];
}

interface FormErrors {
  userId?: string;
  leaveTypeId?: string;
  accrualPerMonth?: string;
  effectiveMonth?: string;
}

function currentUtcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function nextUtcMonth(): string {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 7);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuccessPayload(payload: unknown): payload is { success: true; data: PolicyRateResult } {
  return isRecord(payload) && payload.success === true && isRecord(payload.data);
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || payload.success !== false || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.message === "string" ? payload.error.message : null;
}

export function PolicyRateForm({ employees, leaveTypes }: PolicyRateFormProps) {
  const router = useRouter();
  const trackedTypes = leaveTypes.filter((type) => type.tracksBalance);
  const [errors, setErrors] = useState<FormErrors>({});
  const [userId, setUserId] = useState(employees[0]?.id ?? "");
  const [leaveTypeId, setLeaveTypeId] = useState(trackedTypes[0]?.id ?? "");
  const [accrualPerMonth, setAccrualPerMonth] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState(nextUtcMonth());
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<PolicyRateResult | null>(null);

  function clearFeedback() {
    setResult(null);
    setServerError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();

    const form = event.currentTarget;
    const nextErrors: FormErrors = {};
    const rate = Number(accrualPerMonth);

    if (!userId) {
      nextErrors.userId = "Choose an employee.";
    }

    if (!leaveTypeId) {
      nextErrors.leaveTypeId = "Select a balance-tracked leave type.";
    }

    if (accrualPerMonth.trim() === "" || !Number.isFinite(rate)) {
      nextErrors.accrualPerMonth = "Enter the monthly accrual rate.";
    } else if (rate < 0 || rate > 31) {
      nextErrors.accrualPerMonth = "Enter a rate between 0 and 31 days.";
    } else if (!/^\d+(\.\d{1,2})?$/.test(accrualPerMonth.trim())) {
      nextErrors.accrualPerMonth = "Use at most two decimal places.";
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth)) {
      nextErrors.effectiveMonth = "Choose an effective month.";
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
      const response = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          leaveTypeId,
          accrualPerMonth: rate,
          effectiveFrom: `${effectiveMonth}-01`,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok || !isSuccessPayload(payload)) {
        setServerError(
          getApiErrorMessage(payload) ??
            "The policy rate could not be saved. Check the form and try again.",
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
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <Alert variant="info" title="Changes apply from the effective month">
        A rate change starts with the month you choose and affects only later accrual runs. Past
        months and already-accrued balances are never recalculated.
      </Alert>

      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <Field id="userId" label="Employee" error={errors.userId} required className="min-w-0">
          {({ id, describedBy, invalid, required }) => (
            <Select
              id={id}
              name="userId"
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value);
                clearFeedback();
              }}
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} — {employee.email}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="leaveTypeId"
          label="Leave type"
          hint="Only balance-tracked leave types accrue."
          error={errors.leaveTypeId}
          required
          className="min-w-0"
        >
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
              {trackedTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="accrualPerMonth"
          label="Accrual per month"
          hint="Days per month, up to two decimals."
          error={errors.accrualPerMonth}
          required
          className="min-w-0"
        >
          {({ id, describedBy, invalid, required }) => (
            <Input
              id={id}
              name="accrualPerMonth"
              type="number"
              inputMode="decimal"
              min="0"
              max="31"
              step="0.25"
              value={accrualPerMonth}
              onChange={(event) => {
                setAccrualPerMonth(event.target.value);
                clearFeedback();
              }}
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
            />
          )}
        </Field>

        <Field
          id="effectiveMonth"
          label="Effective month"
          hint="The rate applies from this month's accrual onward; a month that has already accrued must use the next one."
          error={errors.effectiveMonth}
          required
          className="min-w-0"
        >
          {({ id, describedBy, invalid, required }) => (
            <Input
              id={id}
              name="effectiveMonth"
              type="month"
              min={currentUtcMonth()}
              value={effectiveMonth}
              onChange={(event) => {
                setEffectiveMonth(event.target.value);
                clearFeedback();
              }}
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
            />
          )}
        </Field>
      </div>

      {result ? (
        <Alert
          variant="success"
          title={result.auditWritten ? "Policy rate saved" : "No change to save"}
        >
          {result.auditWritten
            ? `The rate is now ${formatDays(result.accrualPerMonth)} per month from ${formatDate(
                result.effectiveFrom,
              )}. One audit row was recorded.`
            : `The rate for ${formatDate(
                result.effectiveFrom,
              )} already matched, so no audit row was written.`}
        </Alert>
      ) : null}

      {serverError ? <Alert variant="danger">{serverError}</Alert> : null}

      <div className="border-border flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-muted-foreground flex items-start gap-2">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />A correction to a future
          month replaces that month&apos;s rate; earlier months stay unchanged. The current month is
          locked once it has accrued.
        </p>
        <Button type="submit" loading={submitting} loadingText="Saving…">
          <Save aria-hidden="true" />
          Save rate
        </Button>
      </div>
    </form>
  );
}

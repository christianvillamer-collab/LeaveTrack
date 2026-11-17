"use client";

import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PersonDirectoryEntry } from "@/lib/types";

export type PersonDialogMode = "profile" | "manager" | "status";

export interface PersonDialogProps {
  mode: PersonDialogMode;
  person: PersonDirectoryEntry | null;
  people: PersonDirectoryEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface FormErrors {
  name?: string;
  email?: string;
  reason?: string;
}

function endpointFor(mode: PersonDialogMode, id: string): string {
  if (mode === "profile") {
    return `/api/people/${id}/profile`;
  }

  if (mode === "manager") {
    return `/api/people/${id}/manager`;
  }

  return `/api/people/${id}/status`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || payload.success !== false || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.message === "string" ? payload.error.message : null;
}

/**
 * Mounts the form only for a real target. The inner form is keyed by mode and
 * person, so opening the dialog for someone else remounts it and its state
 * initialises from props instead of being reset inside an effect.
 */
export function PersonDialog(props: PersonDialogProps) {
  if (!props.person) {
    return null;
  }

  return (
    <PersonDialogForm key={`${props.mode}:${props.person.id}`} {...props} person={props.person} />
  );
}

interface PersonDialogFormProps extends PersonDialogProps {
  person: PersonDirectoryEntry;
}

function PersonDialogForm({
  mode,
  person,
  people,
  open,
  onOpenChange,
  onSaved,
}: PersonDialogFormProps) {
  const formId = useId();
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email);
  const [jobTitle, setJobTitle] = useState(person.jobTitle ?? "");
  const [team, setTeam] = useState(person.team ?? "");
  const [managerId, setManagerId] = useState(person.managerId ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const deactivating = mode === "status" && person.isActive;
  const managerCandidates = people.filter(
    (entry) => entry.isActive && entry.role === "manager" && entry.id !== person.id,
  );
  const currentManagerMissing =
    person.managerId !== null && !managerCandidates.some((entry) => entry.id === person.managerId);

  const title =
    mode === "profile"
      ? `Edit ${person.name}`
      : mode === "manager"
        ? `Assign a manager for ${person.name}`
        : deactivating
          ? `Deactivate ${person.name}`
          : `Reactivate ${person.name}`;

  const description =
    mode === "profile"
      ? "Directory details are editable; the sign-in identity stays linked to this account by its provider subject."
      : mode === "manager"
        ? "Pending requests move with the reporting line automatically; no request record is rewritten."
        : deactivating
          ? "Deactivation is reversible and never deletes the record. The account loses sign-in access."
          : "Reactivating restores sign-in access; previously recorded balances and requests are unchanged.";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);

    const nextErrors: FormErrors = {};

    if (mode === "profile") {
      if (name.trim().length === 0) {
        nextErrors.name = "Enter the person's name.";
      } else if (name.trim().length > 120) {
        nextErrors.name = "Keep the name to 120 characters or fewer.";
      }

      if (email.trim().length === 0) {
        nextErrors.email = "Enter an email address.";
      }
    }

    if (mode === "status" && deactivating && reason.trim().length < 3) {
      nextErrors.reason = "Give a reason of at least 3 characters.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    const body =
      mode === "profile"
        ? {
            name: name.trim(),
            email: email.trim(),
            jobTitle: jobTitle.trim() || null,
            team: team.trim() || null,
          }
        : mode === "manager"
          ? { managerId: managerId || null }
          : {
              isActive: !person.isActive,
              ...(deactivating ? { reason: reason.trim() } : {}),
            };

    try {
      const response = await fetch(endpointFor(mode, person.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setServerError(
          getApiErrorMessage(payload) ?? "The change could not be saved. Check the form and retry.",
        );
        return;
      }

      onOpenChange(false);
      onSaved();
    } catch {
      setServerError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={deactivating ? "danger" : "primary"}
            loading={submitting}
            loadingText="Saving…"
          >
            {mode === "profile"
              ? "Save details"
              : mode === "manager"
                ? "Save manager"
                : deactivating
                  ? "Deactivate account"
                  : "Reactivate account"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        {mode === "profile" ? (
          <>
            <Field id="person-name" label="Name" error={errors.name} required>
              {({ id, describedBy, invalid, required }) => (
                <Input
                  id={id}
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  required={required}
                  autoComplete="off"
                />
              )}
            </Field>

            <Field
              id="person-email"
              label="Directory email"
              hint={
                person.authSubjectLinked
                  ? "The provider sign-in email can differ; identity follows the linked subject."
                  : "No sign-in identity is bound yet. This address is the key for their first verified sign-in, so correct any typo here."
              }
              error={errors.email}
              required
            >
              {({ id, describedBy, invalid, required }) => (
                <Input
                  id={id}
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  required={required}
                  autoComplete="off"
                />
              )}
            </Field>

            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field id="person-job-title" label="Job title" className="min-w-0">
                {({ id, describedBy, invalid, required }) => (
                  <Input
                    id={id}
                    name="jobTitle"
                    value={jobTitle}
                    onChange={(event) => setJobTitle(event.target.value)}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    required={required}
                    autoComplete="off"
                  />
                )}
              </Field>

              <Field id="person-team" label="Team" className="min-w-0">
                {({ id, describedBy, invalid, required }) => (
                  <Input
                    id={id}
                    name="team"
                    value={team}
                    onChange={(event) => setTeam(event.target.value)}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    required={required}
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>
          </>
        ) : null}

        {mode === "manager" ? (
          <Field
            id="person-manager"
            label="Manager"
            hint="Only active people with the manager role are candidates. Reporting cycles are rejected."
          >
            {({ id, describedBy, invalid, required }) => (
              <Select
                id={id}
                name="managerId"
                value={managerId}
                onChange={(event) => setManagerId(event.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
                required={required}
              >
                <option value="">No manager</option>
                {currentManagerMissing ? (
                  <option value={person.managerId ?? ""} disabled>
                    {person.managerName ?? "Current manager"} (unavailable)
                  </option>
                ) : null}
                {managerCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} — {candidate.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {mode === "status" ? (
          <>
            <Alert variant={deactivating ? "warning" : "info"}>
              {deactivating
                ? "Deactivation is blocked for your own account, the last active HR admin, and a manager with active direct reports."
                : "The employee will be able to sign in again once the account is active."}
            </Alert>

            {deactivating ? (
              <Field
                id="person-status-reason"
                label="Reason"
                hint="Recorded in the append-only people audit log."
                error={errors.reason}
                required
              >
                {({ id, describedBy, invalid, required }) => (
                  <Textarea
                    id={id}
                    name="reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    required={required}
                  />
                )}
              </Field>
            ) : null}
          </>
        ) : null}

        {serverError ? <Alert variant="danger">{serverError}</Alert> : null}
      </form>
    </Dialog>
  );
}

"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Role } from "@/lib/auth/roles";
import type { PersonDirectoryEntry } from "@/lib/types";

interface CreateResult {
  id: string;
}

interface FormErrors {
  name?: string;
  email?: string;
}

function getApiErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const envelope = payload as { success?: unknown; error?: { message?: unknown } };

  if (envelope.success !== false || typeof envelope.error?.message !== "string") {
    return null;
  }

  return envelope.error.message;
}

/** HR-only Add user dialog for one person; bulk import remains unchanged. */
export function PersonCreateDialog({ people }: { people: PersonDirectoryEntry[] }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [managerEmail, setManagerEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [team, setTeam] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const managerCandidates = useMemo(
    () => people.filter((person) => person.isActive && person.role === "manager"),
    [people],
  );

  function close() {
    setOpen(false);
    setName("");
    setEmail("");
    setRole("employee");
    setManagerEmail("");
    setJobTitle("");
    setTeam("");
    setErrors({});
    setServerError(null);
    setSubmitting(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);

    const nextErrors: FormErrors = {};

    if (name.trim().length === 0) {
      nextErrors.name = "Enter the person's name.";
    }

    if (email.trim().length === 0) {
      nextErrors.email = "Enter an email address.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role,
          managerEmail: managerEmail || null,
          jobTitle: jobTitle.trim() || null,
          team: team.trim() || null,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setServerError(
          getApiErrorMessage(payload) ?? "The person could not be created. Check the form and retry.",
        );
        return;
      }

      if ((payload as { data?: CreateResult } | null)?.data?.id) {
        close();
        router.refresh();
      }
    } catch {
      setServerError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" />
        Add user
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title="Add user"
        description="Create one person without preparing a bulk import payload."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={submitting}
              loadingText="Creating…"
              disabled={submitting}
            >
              Create user
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
          <Alert variant="info" title="Sign-in identity">
            This creates the directory record only. The provider subject binds on the first verified
            sign-in with this email; no password is collected here.
          </Alert>

          <Field id="create-person-name" label="Name" error={errors.name} required>
            {({ id, describedBy, invalid, required }) => (
              <Input
                id={id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
                required={required}
                placeholder="Alex Rivera"
                autoComplete="name"
              />
            )}
          </Field>

          <Field id="create-person-email" label="Email" error={errors.email} required>
            {({ id, describedBy, invalid, required }) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
                required={required}
                placeholder="alex.rivera@company.com"
                autoComplete="email"
              />
            )}
          </Field>

          <Field id="create-person-role" label="Role" required>
            {({ id, describedBy, required }) => (
              <Select
                id={id}
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                aria-describedby={describedBy}
                required={required}
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="hr_admin">HR admin</option>
              </Select>
            )}
          </Field>

          <Field
            id="create-person-manager"
            label="Manager"
            hint="Optional. Only active managers can be selected."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={managerEmail}
                onChange={(event) => setManagerEmail(event.target.value)}
                aria-describedby={describedBy}
              >
                <option value="">No manager</option>
                {managerCandidates.map((person) => (
                  <option key={person.id} value={person.email}>
                    {person.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="create-person-job-title" label="Job title">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  aria-describedby={describedBy}
                  placeholder="Support Specialist"
                />
              )}
            </Field>

            <Field id="create-person-team" label="Team">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={team}
                  onChange={(event) => setTeam(event.target.value)}
                  aria-describedby={describedBy}
                  placeholder="Customer Success"
                />
              )}
            </Field>
          </div>

          {serverError ? <Alert variant="danger">{serverError}</Alert> : null}
        </form>
      </Dialog>
    </>
  );
}

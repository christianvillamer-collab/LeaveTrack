"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isImportResult(value: unknown): value is ImportResult {
  return (
    isRecord(value) &&
    typeof value.created === "number" &&
    typeof value.updated === "number" &&
    typeof value.skipped === "number"
  );
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || payload.success !== false || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.message === "string" ? payload.error.message : null;
}

const SAMPLE = `[
  {
    "name": "Alex Rivera",
    "email": "alex.rivera@leavetrack.demo",
    "role": "employee",
    "managerEmail": "daniel.okafor@leavetrack.demo",
    "jobTitle": "Support Specialist",
    "team": "Customer Success"
  }
]`;

export function PeopleImportForm() {
  const router = useRouter();
  const [payload, setPayload] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setServerError(null);
    setResult(null);

    let parsed: unknown;

    try {
      parsed = JSON.parse(payload);
    } catch {
      setFieldError("The import must be valid JSON. Check commas, quotes, and brackets.");
      return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      setFieldError("Send a JSON array with at least one person.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/people/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setServerError(
          getApiErrorMessage(body) ?? "The import was rejected. Check the rows and try again.",
        );
        return;
      }

      if (isRecord(body) && body.success === true && isImportResult(body.data)) {
        setResult(body.data);
        router.refresh();
      }
    } catch {
      setServerError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Alert variant="info" title="All-or-nothing bulk import">
        Existing emails are matched case-insensitively. Omitted optional fields are left unchanged;
        send <code>null</code> to clear one. Identical rows are skipped without an audit row; the
        whole batch rolls back if one row fails. A <code>managerEmail</code> must already exist with
        the manager role, or name a manager created earlier in the same batch. Imported people get a
        sign-in identity on their first sign-in with that verified email (or via{" "}
        <code>npm run auth:seed</code> in development).
      </Alert>

      <details className="border-border rounded-md border p-3">
        <summary className="text-small text-foreground cursor-pointer font-medium">
          Show the JSON shape
        </summary>
        <pre className="text-caption text-muted-foreground mt-3 overflow-x-auto">{SAMPLE}</pre>
      </details>

      <Field
        id="people-import"
        label="People JSON"
        hint="Up to 200 rows per request. Required: name and email. Omit a field to leave it unchanged; null clears it."
        error={fieldError ?? undefined}
      >
        {({ id, describedBy, invalid, required }) => (
          <Textarea
            id={id}
            name="people"
            value={payload}
            onChange={(event) => {
              setPayload(event.target.value);
              setFieldError(null);
              setResult(null);
            }}
            aria-describedby={describedBy}
            invalid={invalid}
            required={required}
            spellCheck={false}
            className="min-h-40 font-mono"
            placeholder={SAMPLE}
          />
        )}
      </Field>

      {result ? (
        <Alert variant="success" title="Import complete">
          {result.created} created, {result.updated} updated, and {result.skipped} unchanged
          {result.updated > 0 ? " (updates and creations appear in the audit log)" : ""}.
        </Alert>
      ) : null}

      {serverError ? <Alert variant="danger">{serverError}</Alert> : null}

      <Button type="submit" loading={submitting} loadingText="Importing…">
        <Upload aria-hidden="true" />
        Import people
      </Button>
    </form>
  );
}

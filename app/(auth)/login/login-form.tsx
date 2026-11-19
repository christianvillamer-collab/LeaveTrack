"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const UNAVAILABLE_ERROR = "We could not complete sign-in. Try again in a moment.";

export function LoginForm({ next, configured }: { next?: string; configured: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured || pending) {
      return;
    }

    setError(null);
    setPending(true);

    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          next: form.get("next") ?? undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        redirectTo?: string;
      } | null;

      if (!response.ok || !payload?.redirectTo) {
        setError(payload?.error ?? UNAVAILABLE_ERROR);
        return;
      }

      window.location.assign(payload.redirectTo);
    } catch {
      setError(UNAVAILABLE_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form action="/auth/login" method="post" onSubmit={onSubmit} className="space-y-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {!configured ? (
        <Alert variant="warning">
          Sign-in is not configured yet. An administrator must set the Supabase environment
          variables before anyone can sign in.
        </Alert>
      ) : null}

      <Field id="email" label="Work email" hint="Use your company email address." required>
        {({ id, describedBy, invalid, required }) => (
          <div className="relative">
            <Mail
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              id={id}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
              className="pl-9"
            />
          </div>
        )}
      </Field>

      <Field id="password" label="Password" required>
        {({ id, describedBy, invalid, required }) => (
          <div className="relative">
            <LockKeyhole
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              id={id}
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
              className="pl-9"
            />
          </div>
        )}
      </Field>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={pending}
        loadingText="Signing in…"
        disabled={!configured || pending}
      >
        Sign in
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}

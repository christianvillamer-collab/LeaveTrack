"use client";

import { useActionState } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";

import { signIn, type LoginState } from "@/app/(auth)/login/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: LoginState = { error: null };

export function LoginForm({ next, configured }: { next?: string; configured: boolean }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
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

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={pending}
        loadingText="Signing in…"
        disabled={!configured}
      >
        Sign in
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}

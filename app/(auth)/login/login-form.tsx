"use client";

import { useActionState } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";

import { mockLogin, type LoginState } from "@/app/(auth)/login/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils/cn";

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(mockLogin, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field
        id="email"
        label="Work email"
        hint="Any valid email works in the Day 0 preview."
        required
      >
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
              defaultValue="maya.chen@leavetrack.demo"
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
              className="pl-9"
            />
          </div>
        )}
      </Field>

      <Field id="password" label="Password" hint="Not checked — this is a mock session." required>
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
              placeholder="Any password"
              defaultValue="demo-password"
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
              className="pl-9"
            />
          </div>
        )}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-small text-foreground font-semibold">Demo role</legend>
        <p className="text-caption text-muted-foreground">
          Each role sees a different workspace and navigation.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {ROLES.map((role: Role) => (
            <label
              key={role}
              className={cn(
                "border-border bg-surface cursor-pointer rounded-md border p-3 text-left transition-colors",
                "hover:border-primary/40 hover:bg-primary-subtle/40",
                "has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-[:checked]:shadow-xs",
                "has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2",
              )}
            >
              <input
                type="radio"
                name="role"
                value={role}
                defaultChecked={role === "employee"}
                className="sr-only"
              />
              <span className="text-small text-foreground block font-semibold">
                {ROLE_LABELS[role]}
              </span>
              <span className="text-caption text-secondary mt-1 block">
                {ROLE_DESCRIPTIONS[role]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={pending}
        loadingText="Signing in…"
      >
        Sign in
        <ArrowRight aria-hidden="true" />
      </Button>

      <p className="text-caption text-muted-foreground text-center">
        Demo only. No real authentication provider is configured.
      </p>
    </form>
  );
}

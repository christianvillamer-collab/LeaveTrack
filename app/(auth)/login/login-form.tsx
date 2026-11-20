"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Mail, Sparkles } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DEMO_ACCOUNTS, DEMO_ACCOUNT_LIST, type DemoAccountId } from "@/lib/auth/demo-accounts";

const UNAVAILABLE_ERROR = "We could not complete sign-in. Try again in a moment.";

export function LoginForm({
  next,
  configured,
  demoEnabled,
}: {
  next?: string;
  configured: boolean;
  demoEnabled: boolean;
}) {
  const [email, setEmail] = useState("");
  const [demoAccount, setDemoAccount] = useState<DemoAccountId | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedDemo = demoAccount ? DEMO_ACCOUNTS[demoAccount] : null;

  async function signIn(url: string, fetchOptions: RequestInit) {
    if (!configured || pending) {
      return;
    }

    setError(null);
    setPending(true);

    try {
      const response = await fetch(url, fetchOptions);
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    await signIn("/auth/login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: form.get("password"),
        next: form.get("next") ?? undefined,
      }),
    });
  }

  async function onDemoSignIn() {
    if (!demoAccount || pending) {
      return;
    }

    await signIn("/auth/demo-login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ account: demoAccount, next }),
    });
  }

  function chooseDemoAccount(id: DemoAccountId | "") {
    setDemoAccount(id);
    setEmail(id ? DEMO_ACCOUNTS[id].email : "");
    setError(null);
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

      {demoEnabled && configured ? (
        <div className="bg-surface-muted space-y-3 rounded-lg border border-border p-4">
          <p className="text-small flex items-center gap-2 font-semibold">
            <Sparkles aria-hidden="true" className="text-primary size-4" />
            Demo accounts
          </p>

          <Field
            id="demo-account"
            label="Choose a demo role"
            hint="One-click sign-in. The demo password stays on the server."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={demoAccount}
                aria-describedby={describedBy}
                disabled={pending}
                onChange={(event) => chooseDemoAccount(event.target.value as DemoAccountId | "")}
              >
                <option value="">Select a role…</option>
                {DEMO_ACCOUNT_LIST.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} — {account.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {selectedDemo ? (
            <p className="text-caption text-muted-foreground">
              Email: <span className="text-foreground">{selectedDemo.email}</span>
            </p>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            loading={pending && Boolean(demoAccount)}
            loadingText="Signing in…"
            disabled={!demoAccount || pending}
            onClick={onDemoSignIn}
          >
            Continue as {selectedDemo?.label ?? "demo user"}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
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
              value={email}
              aria-describedby={describedBy}
              invalid={invalid}
              required={required}
              className="pl-9"
              onChange={(event) => {
                const value = event.target.value;
                setEmail(value);

                if (demoAccount && value !== DEMO_ACCOUNTS[demoAccount].email) {
                  setDemoAccount("");
                }
              }}
            />
          </div>
        )}
      </Field>

      <Field
        id="password"
        label="Password"
        required={!selectedDemo}
        hint={
          selectedDemo
            ? "Demo sign-in uses the server-held demo password; leave this blank."
            : undefined
        }
      >
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
              placeholder={selectedDemo ? "Not needed for demo sign-in" : "Enter your password"}
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
        loading={pending && !demoAccount}
        loadingText="Signing in…"
        disabled={!configured || pending}
      >
        Sign in
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}

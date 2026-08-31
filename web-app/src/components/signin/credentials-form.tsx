"use client";

import { PASSWORD_MIN_LENGTH } from "@/lib/limits/password-rules";

export function CredentialsForm({
  next,
  tab,
  code,
  idPrefix,
}: {
  next: string;
  tab: string;
  code?: string;
  idPrefix: string;
}) {
  return (
    <form method="post" className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="tab" value={tab} />
      {code === undefined ? null : <input type="hidden" name="code" value={code} />}

      <label className="flex flex-col gap-1.5 text-sm" htmlFor={`${idPrefix}-email`}>
        <span className="opacity-60">Email</span>
        <input
          id={`${idPrefix}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm" htmlFor={`${idPrefix}-password`}>
        <span className="opacity-60">Password</span>
        <input
          id={`${idPrefix}-password`}
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="current-password"
          className="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
        <span className="text-[11px] opacity-45">
          At least {PASSWORD_MIN_LENGTH} characters. No other rules.
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          formAction="/api/auth/password/login"
          className="flex-1 rounded-lg border border-current/20 px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-70"
        >
          Sign in
        </button>
        <button
          type="submit"
          formAction="/api/auth/password/signup"
          className="flex-1 rounded-lg border border-current/20 px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-70"
        >
          Create account
        </button>
      </div>
    </form>
  );
}

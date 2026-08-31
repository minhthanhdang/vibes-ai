"use client";

import { CredentialsForm } from "./credentials-form";

export function NormalPanel({ next }: { next: string }) {
  return (
    <div className="flex flex-col gap-5">
      <a
        href={`/api/auth/google?next=${encodeURIComponent(next)}`}
        className="rounded-lg border border-current/20 px-4 py-3 text-center text-sm font-medium transition-opacity hover:opacity-70"
      >
        Continue with Google
      </a>

      <div className="flex items-center gap-3 text-[11px] opacity-40">
        <span className="h-px flex-1 bg-current/20" />
        or
        <span className="h-px flex-1 bg-current/20" />
      </div>

      <CredentialsForm next={next} tab="normal" idPrefix="normal" />
    </div>
  );
}

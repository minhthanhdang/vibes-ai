"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CredentialsForm } from "./credentials-form";

export function JudgePanel({
  next,
  googleOpen,
  onNotAJudge,
}: {
  next: string;
  googleOpen: boolean;
  onNotAJudge: () => void;
}) {
  const [code, setCode] = useState("");
  const reduce = useReducedMotion();

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-lg bg-current/5 px-4 py-3 text-sm font-medium">
        You are signing in as a judge. Your account gets the larger allowance for the event.
      </p>

      <label className="flex flex-col gap-1.5 text-sm" htmlFor="judge-code">
        <span className="opacity-60">Access code</span>
        <input
          id="judge-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="The code handed out at the event"
          className="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
      </label>

      <CredentialsForm next={next} tab="judges" code={code} idPrefix="judge" />

      {googleOpen && (
        <>
          <div className="flex items-center gap-3 text-[11px] opacity-40">
            <span className="h-px flex-1 bg-current/20" />
            or
            <span className="h-px flex-1 bg-current/20" />
          </div>

          <form method="post" action="/api/auth/google">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="tab" value="judges" />
            <input type="hidden" name="code" value={code} />
            <button
              type="submit"
              className="w-full rounded-lg border border-current/20 px-4 py-3 text-center text-sm font-medium transition-opacity hover:opacity-70"
            >
              Continue with Google
            </button>
          </form>
        </>
      )}

      <button
        type="button"
        onClick={onNotAJudge}
        aria-label="Not a judge — switch to the ordinary sign-in tab"
        className="flex items-center gap-1.5 self-start text-sm opacity-60 transition-opacity hover:opacity-100"
      >
        Not a judge? Sign in here instead
        <motion.span
          aria-hidden
          animate={reduce ? undefined : { x: [0, 4, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          →
        </motion.span>
      </button>
    </div>
  );
}

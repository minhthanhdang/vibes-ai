"use client";

import { useEffect, useState } from "react";
import { stepsSaid, type TurnStep } from "@/lib/agent/shared/conversation";
import type { ChatProgress } from "@/lib/agent/shared/chat-log";
import { MarkdownText } from "@/components/markdown-text";

const LIVE_STEP_LIMIT = 5;

const said = (name: string) => name.replace(/_/g, " ");

function StepRow({ step }: { step: TurnStep }) {
  const mark = step.ok === undefined ? "·" : step.ok ? "✓" : "✕";
  return (
    <li className={`flex gap-2 text-xs ${step.agent ? "pl-3 opacity-50" : "opacity-70"}`}>
      <span aria-hidden className={step.ok === false ? "text-red-500" : undefined}>
        {mark}
      </span>
      <span className="truncate">
        {step.agent ? <span className="opacity-70">{step.agent} · </span> : null}
        {said(step.name)}
      </span>
    </li>
  );
}

function useElapsed(startedAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
}

export function TurnProgress({ progress }: { progress: ChatProgress }) {
  const elapsed = useElapsed(progress.startedAt);
  const own = progress.steps.filter((step) => !step.agent).length;
  const shown = progress.steps.slice(-LIVE_STEP_LIMIT);
  const earlier = progress.steps.length - shown.length;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-current/10 px-3 py-2">
      <div role="status" aria-live="polite" aria-atomic="true" className="line-clamp-2 text-xs opacity-70">
        {progress.thought ? (
          <MarkdownText text={progress.thought} className="inline [&_p]:inline" />
        ) : (
          "Thinking…"
        )}
        <span className="opacity-60"> · {elapsed}s</span>
        {own ? <span className="opacity-60"> · {own} step{own === 1 ? "" : "s"}</span> : null}
      </div>
      {progress.said ? (
        <MarkdownText text={progress.said} className="line-clamp-3 text-xs opacity-80" />
      ) : null}
      {progress.stalled ? (
        <p className="text-xs opacity-60">
          Nothing has come back for a couple of minutes. The turn is still running and its work is
          kept either way — reloading will show the answer once it lands.
        </p>
      ) : null}
      {progress.steps.length ? (
        <ul className="flex flex-col gap-0.5">
          {earlier ? <li className="pl-1 text-xs opacity-40">+{earlier} earlier</li> : null}
          {shown.map((step) => (
            <StepRow key={step.callId} step={step} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TurnSummary({ steps }: { steps: TurnStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="text-[11px] opacity-50 hover:opacity-80"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span> {stepsSaid(steps)}
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {steps.map((step) => (
            <StepRow key={step.callId} step={step} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

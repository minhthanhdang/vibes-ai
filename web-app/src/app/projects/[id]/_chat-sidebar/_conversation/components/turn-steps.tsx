"use client";

import { useEffect, useState } from "react";
import { stepsSaid, type TurnStep } from "@/lib/agent/shared/conversation";
import type { ChatProgress } from "@/lib/agent/shared/chat-log";

/// What the turn is doing, and — once it is done — what it did.
///
/// One file and one row component for both, so the block does not visibly change
/// shape at the moment the turn settles: the same steps are drawn by the same
/// rows, first from the live stream and then from the stored parts.
///
/// It replaces a static `Thinking…` that stood for two and three minutes over
/// the most expensive thing the product does.

/// How many steps the live block shows at once.
///
/// `MAX_TOOL_ROUNDS` is 100 and a round can ask for several tools, so an
/// unbounded list would push the composer off the screen. A window rather than a
/// scroll box, which is `tool-window.ts`'s idiom one layer down: a scroll
/// container inside an already-scrolling column, with new rows arriving into it,
/// is a scroll-anchoring problem for no gain — the full list is under the reply
/// thirty seconds later.
const LIVE_STEP_LIMIT = 5;

const said = (name: string) => name.replace(/_/g, " ");

/// A tool's own name, its state, and — for a nested agent — who ran it.
///
/// One level of indent regardless of depth: the sidebar is narrow, nesting is
/// unbounded, and what is useful is "this is the designer, not the orchestrator"
/// rather than the depth number.
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

/// The seconds since the question went out, ticking.
///
/// In the component and never in the store: a 1 Hz clock in zustand would
/// re-render the whole column once a second for three minutes.
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
  /// Top-level only, so the number the user watches climb is the number still
  /// there after the answer lands. A live count including the designer's own
  /// rounds would halve when the turn settles, which reads as the column losing
  /// something.
  const own = progress.steps.filter((step) => !step.agent).length;
  const shown = progress.steps.slice(-LIVE_STEP_LIMIT);
  const earlier = progress.steps.length - shown.length;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-current/10 px-3 py-2">
      {/* The live region is this line alone. A thought summary replacing itself
          is exactly one polite announcement; putting it on the whole block would
          have a screen reader read forty tool names.

          `role="status"` and not `role="progressbar"`: the uploader's bar has a
          total, and a turn does not know how many rounds it will take, so
          `aria-valuenow` would be a number with no maximum to mean anything
          against. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="line-clamp-2 text-xs opacity-70">
        {progress.thought ?? "Thinking…"}
        <span className="opacity-60"> · {elapsed}s</span>
        {own ? <span className="opacity-60"> · {own} step{own === 1 ? "" : "s"}</span> : null}
      </p>
      {/* The reply typing itself out, or a round's narration on its way to
          being a bubble. Never retracted: the next round's `calling` clears it
          and the answer replaces the whole block. */}
      {progress.said ? (
        <p className="line-clamp-3 text-xs opacity-80">{progress.said}</p>
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

/// The turn's own work under the reply, collapsed. The information was already
/// in the row — `call` and `result` have been stored on every assistant message
/// all along — and what was missing was the projection.
///
/// Collapsed by default and local state, `ShownResults`'s reasoning: it is about
/// a button that is on screen.
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
      {/* Unwindowed, unlike the live block: the record is the point, and you
          opened it to read it. */}
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

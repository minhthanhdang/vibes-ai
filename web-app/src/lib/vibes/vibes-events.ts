import type { AgentEvent } from "@/lib/agent/shared/turn-events";

/// One page of a run, as the panel hears about it.
///
/// `AgentEvent` verbatim for the rounds, because a designer round is a designer
/// round whether agent 6 asked for it or the form did — one vocabulary, one
/// reducer, one row component. What is added is the terminal event, which is
/// this flow's own: `orchestrator.send` ends with an answer and a conversation,
/// and this ends with a page.
///
/// Separate from `turn-events.ts` so that module stays about a turn.
export type VibesEvent =
  | AgentEvent
  /// The page, settled. Always last, and always after the row is committed — a
  /// browser holding this is holding a stored outcome.
  ///
  /// It carries what the mutation used to *return*: a generator's return value
  /// is not delivered to a tRPC client, so the answer becomes the final event
  /// rather than the resolved value.
  | { kind: "page"; outcome: VibesPageReport; conversationId: string };

/// One page's outcome as the wire carries it — the mutation's own return value,
/// unchanged, which is what keeps `vibesLoopSettled` untouched.
///
/// Wider than `VibesPageOutcome`: the browser's loop reads the `pageId`, the
/// line and `empty` and nothing else, while `npm run vibes:run` prices the page
/// off its `runId` and prints what it called. Both read the same event.
export type VibesPageReport =
  | { pageId: string; line: string; empty: boolean; calls: string[]; runId: string }
  | { pageId: string; error: string };

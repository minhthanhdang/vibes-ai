import type { ChatAttachment } from "@/lib/agent/shared/attachments";
import type { Part, TurnStep } from "@/lib/agent/shared/conversation";

/// What a turn says about itself while it is running — the pure half, so the
/// browser can import it. The emitting half is `server/agents/shared/agent-scope.ts`.
///
/// Loaded on both sides of the seam `conversation.ts` already occupies, so
/// nothing `server-only` may be imported here. Every field is plain data for a
/// second reason: these go over the wire through superjson, and a class
/// instance or a `Date` is a shape the other end would have to be taught.

/// One tool the model asked for. `args` rides because a step that wants to say
/// more than a tool's name later has to be given the material now; nothing
/// draws it today.
export type EventCall = { callId: string; name: string; args: Record<string, unknown> };

/// One tool that answered. Deliberately not the response itself: the column
/// shows that a step finished and whether it worked, and the answer is already
/// on its way to the row through `forStorage`.
export type EventResult = { callId: string; name: string; ok: boolean };

/// Which agent produced the event, and the ones it is running inside.
///
/// Mirrors `TranscriptRecord`'s `agent`/`under`/`seq` on purpose: the two come
/// out of the same scope and the same stack, so a reader of one can read the
/// other. A designer's round inside an orchestrator's `design_page` call is
/// `{ agent: "designer", under: ["orchestrator"] }` in both.
type FromAgent = {
  agent: string;
  /// Outermost first, so `under.length` is the depth the column indents by.
  under: string[];
  /// Monotonic within the turn and shared across its agents, so events read in
  /// the order they happened whichever agent made them.
  seq: number;
};

/// The two terminal events are the *procedure's* and not an agent's, which is
/// why they carry no label: by the time either is sent the scope is closed and
/// what is being reported is the turn, not a round inside it.
export type TurnEvent =
  /// A thought summary, as the model wrote it. Live only — `forStorage` drops
  /// the part this arrived on, so nothing here is ever a row.
  | (FromAgent & { kind: "thinking"; text: string })
  /// A round handing over to its tools, sent before they are awaited so the
  /// column names the work while it is happening rather than after.
  | (FromAgent & { kind: "calling"; calls: EventCall[] })
  | (FromAgent & { kind: "called"; results: EventResult[] })
  /// Text as it is generated. Narration on a round that turns out to call
  /// tools, and the reply itself on the round that ends the loop.
  | (FromAgent & { kind: "delta"; text: string })
  /// The turn, settled. `parts` is the assistant row exactly as it was stored,
  /// so the session that ran the turn holds the same message a reload would
  /// fetch — without it the collapsed summary is empty until the page reloads,
  /// which is the wrong way round.
  | {
      kind: "answer";
      reply: string;
      attachments: ChatAttachment[];
      conversationId: string;
      parts: Part[];
    }
  | { kind: "failed"; error: string };

/// The events an agent scope produces, which is every kind but the two the
/// procedure sends itself.
export type AgentEvent = Extract<TurnEvent, FromAgent>;

/// What `emit` is given: the event minus the labels the scope puts on it.
export type EmittedEvent =
  | { kind: "thinking"; text: string }
  | { kind: "calling"; calls: EventCall[] }
  | { kind: "called"; results: EventResult[] }
  | { kind: "delta"; text: string };

/// A step's key in a live list. The agent goes in front because two agents
/// number their calls independently — agent 6's first call and agent 8's first
/// call are both `1.1`, and a bare `callId` would have the designer's result
/// settle the orchestrator's step.
///
/// An agent with nothing enclosing it keeps its bare id, so a step drawn live
/// and the same step read back off the stored row through `stepsOf` are one
/// chip under one name.
///
/// Exported because the hold the browser keeps on a board (`board-hold.ts`)
/// matches its own `calling` against its own `called` and needs the collision
/// settled the same way — a designer's `1.1` closing the orchestrator's
/// `design_page` would release a board that is still being written.
export const callKey = (event: AgentEvent, callId: string) =>
  event.under.length ? `${event.agent}/${callId}` : callId;

/// One event folded into a live step list, shared by the two things that keep
/// one: the chat column's `progress` and the Vibes run's `live`.
///
/// Returns the **same array** when nothing changed — a duplicate round, a
/// result for a call nobody announced. Both callers rebuild a store value from
/// this on every event, and a new array each time is a re-render per round.
///
/// Steps are appended and never re-ordered, and results are matched by key and
/// never by name: a round that crops two references in parallel has two calls
/// with one name in it.
export function stepsAfter(steps: readonly TurnStep[], event: AgentEvent): readonly TurnStep[] {
  if (event.kind === "calling") {
    const known = new Set(steps.map((step) => step.callId));
    const added = event.calls
      .filter((call) => !known.has(callKey(event, call.callId)))
      .map(({ callId, name }): TurnStep => ({
        callId: callKey(event, callId),
        name,
        ...(event.under.length ? { agent: event.agent } : {}),
      }));
    return added.length ? [...steps, ...added] : steps;
  }
  if (event.kind === "called") {
    const settled = new Map(event.results.map((r) => [callKey(event, r.callId), r.ok]));
    /// A result whose call nobody announced is not a step: a row the column
    /// could not label is worse than a row it does not draw.
    if (!steps.some((step) => settled.has(step.callId))) return steps;
    return steps.map((step) =>
      settled.has(step.callId) ? { ...step, ok: settled.get(step.callId)! } : step,
    );
  }
  return steps;
}

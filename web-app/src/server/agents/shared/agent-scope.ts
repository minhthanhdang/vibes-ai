import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { withTranscript } from "@/server/agents/shared/transcript";
import type { AgentEvent, EmittedEvent } from "@/lib/agent/shared/turn-events";
import type { GeneratePart, GenerateWatcher } from "@/server/google/vertex";

/// Which agent is running, and who — if anyone — is watching it.
///
/// This is `transcript.ts`'s scope generalised, and it exists because progress
/// events need exactly what the transcript already needed: a stack of agent
/// labels where an inner agent joins its parent's scope. Agent 8 running inside
/// agent 6's `design_page` call has to label its own rounds without agent 6
/// passing it anything, because the toolset seam between them exists precisely
/// to keep the orchestrator from knowing what its tools do.
///
/// Threading an `onEvent` callback instead would cross six layers — the router,
/// the turn, the orchestrator loop, the toolset's `execute`, agent 8's door and
/// agent 8's own loop — and two of those hops are pinned byte-for-byte by
/// `current-board.test.mts`.
///
/// **Two storages, one door.** The transcript keeps its own scope, because what
/// it holds is turn-level writing machinery — a file stem, an append chain, a
/// failure count — and because its contract is that `AGENT_TRANSCRIPT_DIR`
/// unset means not one line of behaviour changed, which is the opposite of what
/// a production feature wants. `withAgent` below opens both in one call, so the
/// two stacks cannot nest differently: there is no door that pushes one without
/// the other. What this scope adds is that it is opened *unconditionally*,
/// which is what makes `agentPath()` answer on a deployment with no transcript
/// directory set — the state every deployment is actually in.

type AgentScope = {
  /// The stack, outermost first. Copied on entry rather than pushed into, for
  /// `transcript.ts`'s reason and the bug it says it already paid for once: a
  /// round runs its tools through `Promise.all`, so two agents can be inside
  /// one turn at once and a shared stack would label the second agent's rounds
  /// with the first's name.
  agents: string[];
  /// Set by the procedure that streams, and absent everywhere else — `npm run
  /// smoke`, the Vibes CLI, every test. Absent is what makes `emit` a
  /// `getStore()` and a return.
  ///
  /// `AgentEvent` and not the whole of `TurnEvent`: a scope only ever produces
  /// the events an agent has, and the terminal ones — an answer, a designed
  /// page — belong to whichever procedure is doing the streaming. Which is also
  /// what lets two procedures with two different terminal events share one
  /// scope.
  onEvent?: (event: AgentEvent) => void;
  /// One sequence for the whole turn, shared across its agents, so events read
  /// in the order they happened whichever agent made them. `TranscriptRecord`'s
  /// `seq` and this are the same idea over the same stack.
  next?: () => number;
};

const scopes = new AsyncLocalStorage<AgentScope>();

/// Wraps an agent's public entry. A wrapper rather than a `startAgent()` for
/// the reason the transcript's is: a nested agent finds the scope already open
/// and joins it, so one chat message that designs a page is one turn with both
/// agents' events in the order they happened.
///
/// The transcript is opened inside the same call and never separately. A door
/// that lost one of these two would be an agent that silently stopped being
/// recorded, or one whose events lost their name — and `agent-scopes.test.mts`
/// is what stops that happening in either direction.
export function withAgent<T>(agent: string, run: () => Promise<T>): Promise<T> {
  const open = scopes.getStore();
  const scope: AgentScope = open
    ? { ...open, agents: [...open.agents, agent] }
    : { agents: [agent] };
  return scopes.run(scope, () => withTranscript(agent, run));
}

/// Opens the turn's event sink. Called once, by the procedure that streams, and
/// *outside* the agent door — so the sink is already in scope when the door
/// pushes the first label, and the seq counter belongs to the turn rather than
/// to whichever agent happened to start it.
///
/// A second `withEvents` inside an open one replaces the sink rather than
/// stacking: there is one turn on the wire and one thing reading it.
export function withEvents<T>(onEvent: (event: AgentEvent) => void, run: () => Promise<T>): Promise<T> {
  const open = scopes.getStore();
  let seq = 0;
  return scopes.run({ ...(open ?? { agents: [] }), onEvent, next: () => (seq += 1) }, run);
}

/// Whether anyone is watching this turn. The transcript's `transcribing` twin,
/// and the cheapest way for a caller to skip assembling an event nobody reads.
export function watching(): boolean {
  return scopes.getStore()?.onEvent !== undefined;
}

/// The agent that is running and the ones enclosing it. Answers `{ agent: "",
/// under: [] }` outside any door, which is what a caller that is not inside an
/// agent should read as rather than a throw.
export function agentPath(): { agent: string; under: string[] } {
  const agents = scopes.getStore()?.agents ?? [];
  return { agent: agents[agents.length - 1] ?? "", under: agents.slice(0, -1) };
}

/// One event, labelled by the scope and handed to whoever is watching.
///
/// Synchronous and `void`-returning on purpose. A producer that could await the
/// sink is a producer a dead socket can stall, and the whole guarantee this
/// feature is built around is that a turn outlives the tab watching it — so the
/// emit physically cannot apply backpressure to the model loop.
///
/// Guarded whole, for `recordModelCall`'s reason: a stream nobody is reading
/// must never be able to break the work being streamed.
export function emit(event: EmittedEvent): void {
  try {
    const scope = scopes.getStore();
    if (!scope?.onEvent) return;
    const { agent, under } = agentPath();
    scope.onEvent({ ...event, agent, under, seq: scope.next?.() ?? 0 } as AgentEvent);
  } catch (cause) {
    console.error("agent progress event failed:", cause);
  }
}

/// What a streamed round's chunks mean to whoever is watching the turn.
///
/// The split is `textOf`'s and `thoughtsOf`'s, applied one chunk at a time: a
/// part marked `thought` is the label, and a plain text part is the reply typing
/// itself out. Both loops hand this to `generateContentStream` as its watcher,
/// so the two agents narrate identically and a reader of one can read the other.
///
/// A no-op when nobody is watching — `emit` is a `getStore()` and a return — and
/// a no-op again when the injected `generate` is a fake that never calls it,
/// which is every test in the suite. A fake that ignores the watcher is a legal
/// stream that emitted nothing, and that is the honest reading of it.
///
/// Takes nothing: a delta has no `callId` to hang off, and the `seq` the scope
/// stamps on each event is already the ordering a reader needs.
export function watchedBy(): GenerateWatcher {
  return {
    chunk(parts: GeneratePart[]) {
      for (const part of parts) {
        if (!part.text) continue;
        emit(part.thought ? { kind: "thinking", text: part.text } : { kind: "delta", text: part.text });
      }
    },
  };
}

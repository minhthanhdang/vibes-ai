import type { ChatAttachment } from "@/lib/agent/shared/attachments";
import type { Part, TurnStep } from "@/lib/agent/shared/conversation";

export type EventCall = { callId: string; name: string; args: Record<string, unknown> };

export type EventResult = { callId: string; name: string; ok: boolean };

type FromAgent = {
  agent: string;
  under: string[];
  seq: number;
};

export type TurnEvent =
  | (FromAgent & { kind: "thinking"; text: string })
  | (FromAgent & { kind: "calling"; calls: EventCall[] })
  | (FromAgent & { kind: "called"; results: EventResult[] })
  | (FromAgent & { kind: "delta"; text: string })
  | {
      kind: "answer";
      reply: string;
      attachments: ChatAttachment[];
      conversationId: string;
      parts: Part[];
    }
  | { kind: "failed"; error: string };

export type AgentEvent = Extract<TurnEvent, FromAgent>;

export type EmittedEvent =
  | { kind: "thinking"; text: string }
  | { kind: "calling"; calls: EventCall[] }
  | { kind: "called"; results: EventResult[] }
  | { kind: "delta"; text: string };

export const callKey = (event: AgentEvent, callId: string) =>
  event.under.length ? `${event.agent}/${callId}` : callId;

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
    if (!steps.some((step) => settled.has(step.callId))) return steps;
    return steps.map((step) =>
      settled.has(step.callId) ? { ...step, ok: settled.get(step.callId)! } : step,
    );
  }
  return steps;
}

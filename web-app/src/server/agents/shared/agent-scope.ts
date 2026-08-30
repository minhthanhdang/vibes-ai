import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { withTranscript } from "@/server/agents/shared/transcript";
import type { AgentEvent, EmittedEvent } from "@/lib/agent/shared/turn-events";
import type { GeneratePart, GenerateWatcher } from "@/server/google/vertex";

type AgentScope = {
  agents: string[];
  onEvent?: (event: AgentEvent) => void;
  next?: () => number;
};

const scopes = new AsyncLocalStorage<AgentScope>();

export function withAgent<T>(agent: string, run: () => Promise<T>): Promise<T> {
  const open = scopes.getStore();
  const scope: AgentScope = open
    ? { ...open, agents: [...open.agents, agent] }
    : { agents: [agent] };
  return scopes.run(scope, () => withTranscript(agent, run));
}

export function withEvents<T>(onEvent: (event: AgentEvent) => void, run: () => Promise<T>): Promise<T> {
  const open = scopes.getStore();
  let seq = 0;
  return scopes.run({ ...(open ?? { agents: [] }), onEvent, next: () => (seq += 1) }, run);
}

export function watching(): boolean {
  return scopes.getStore()?.onEvent !== undefined;
}

export function agentPath(): { agent: string; under: string[] } {
  const agents = scopes.getStore()?.agents ?? [];
  return { agent: agents[agents.length - 1] ?? "", under: agents.slice(0, -1) };
}

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

import "server-only";
import { vertexFetch } from "./vertex";
import { env } from "@/env";

/// Agent Runtime (formerly Vertex AI Agent Engine — infra.md §XI). Agents 1-6
/// are deployed with `adk deploy agent_engine` and reached over REST from
/// route handlers only, never the browser.
function resource() {
  const name = env().AGENT_ENGINE_RESOURCE;
  if (!name) throw new Error("AGENT_ENGINE_RESOURCE is unset — deploy the orchestrator first");
  return name;
}

/// The transport, injected the way `generateContent` is injected into the
/// agents (tech-spec §VII "Keep the seam"). Nothing here is a model call, so
/// the SDK has no surface for it and `vertexFetch` stays — but a module that
/// imports its one outbound call directly can only be read against a deployed
/// Agent Engine, and there is none: `AGENT_ENGINE_RESOURCE` is unset, so every
/// rule below about what this module sends and how it reads the answer back was
/// unassertable and therefore unasserted.
export type AgentTransport = typeof vertexFetch;

export async function query(input: Record<string, unknown>, send: AgentTransport = vertexFetch) {
  const response = await send(`${resource()}:query`, {
    method: "POST",
    body: JSON.stringify({ class_method: "query", input }),
  });
  return (await response.json()) as { output?: unknown };
}

/// Yields one parsed SSE payload per agent event. A full agent-1 browse
/// outlives a Vercel function (~800s cap, infra.md §VII), so long runs should
/// be kicked off as an AgentRun row and polled — reserve this for short calls.
export async function* streamQuery(
  input: Record<string, unknown>,
  send: AgentTransport = vertexFetch,
) {
  const response = await send(`${resource()}:streamQuery?alt=sse`, {
    method: "POST",
    body: JSON.stringify({ class_method: "stream_query", input }),
  });
  if (!response.body) return;

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  /// A consumer that stops early — the first event it was waiting for, a thrown
  /// error downstream — returns this generator here, and without the cancel the
  /// response body stays open with a locked reader for the life of the process.
  /// It is the caller's `break` that pays for it, so it cannot be the caller's
  /// job to clean up.
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line.startsWith("data:") ? line.slice(5) : line) as unknown;
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    await reader.cancel();
  }
}

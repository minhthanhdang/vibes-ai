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

export async function query(input: Record<string, unknown>) {
  const response = await vertexFetch(`${resource()}:query`, {
    method: "POST",
    body: JSON.stringify({ class_method: "query", input }),
  });
  return (await response.json()) as { output?: unknown };
}

/// Yields one parsed SSE payload per agent event. A full agent-1 browse
/// outlives a Vercel function (~800s cap, infra.md §VII), so long runs should
/// be kicked off as an AgentRun row and polled — reserve this for short calls.
export async function* streamQuery(input: Record<string, unknown>) {
  const response = await vertexFetch(`${resource()}:streamQuery?alt=sse`, {
    method: "POST",
    body: JSON.stringify({ class_method: "stream_query", input }),
  });
  if (!response.body) return;

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

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
}

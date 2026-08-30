import "server-only";
import { vertexFetch } from "./vertex";
import { env } from "@/env";

function resource() {
  const name = env().AGENT_ENGINE_RESOURCE;
  if (!name) throw new Error("AGENT_ENGINE_RESOURCE is unset — deploy the orchestrator first");
  return name;
}

export type AgentTransport = typeof vertexFetch;

export async function query(input: Record<string, unknown>, send: AgentTransport = vertexFetch) {
  const response = await send(`${resource()}:query`, {
    method: "POST",
    body: JSON.stringify({ class_method: "query", input }),
  });
  return (await response.json()) as { output?: unknown };
}

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

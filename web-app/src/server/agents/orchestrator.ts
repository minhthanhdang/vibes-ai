import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContent,
  textOf,
  type Content,
  type FunctionDeclaration,
} from "@/server/google/vertex";

/// tech-spec §III.6: the orchestrator routes, it never does the work itself.
/// Agents 2–5 will arrive as tool calls here rather than as an ADK
/// `sub_agents` transfer — the Agent Engine deployment does not exist yet.
const SYSTEM_INSTRUCTION = `You are the orchestrator of a film director's reference assistant.

The director talks to you in plain language about the look they are chasing.
Help them articulate it: palette, lighting, texture, composition, subject,
contrast and depth are the vocabulary the rest of the pipeline works in, so
reflect their description back in those terms and ask about the ones they left
open.

You have no tools yet. You cannot add, find or edit images — the director
uploads their own references to the project. If they ask you to fetch, search
or change an image, say plainly that you cannot do it yet and that references
come from their own uploads. Never invent image URLs and never describe images
you have not been given.

Keep replies to a few sentences.`;

export type ToolCall = { name: string; args: Record<string, unknown> };
export type ToolExecutor = (call: ToolCall) => Promise<Record<string, unknown>>;

export type Turn = { role: "user" | "model"; text: string };

/// The model gets at most this many tool rounds before we make it answer — a
/// stuck model calling the same tool forever is a real failure mode.
const MAX_TOOL_ROUNDS = 3;

export async function orchestrate({
  message,
  history = [],
  tools = [],
  execute,
}: {
  message: string;
  history?: Turn[];
  tools?: FunctionDeclaration[];
  execute?: ToolExecutor;
}) {
  const contents: Content[] = [
    ...history.map(({ role, text }) => ({ role, parts: [{ text }] })),
    { role: "user" as const, parts: [{ text: message }] },
  ];
  const calls: ToolCall[] = [];

  for (let round = 0; ; round++) {
    const response = await generateContent(MODELS.PRO, contents, {
      systemInstruction: SYSTEM_INSTRUCTION,
      // An empty `functionDeclarations` array is not the same as no tools —
      // Vertex rejects it — so the key is omitted entirely when none are given.
      ...(tools.length && { tools: [{ functionDeclarations: tools }] }),
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);

    if (!execute || !requested.length || round >= MAX_TOOL_ROUNDS) {
      return { reply: textOf(parts) || "…", calls };
    }
    const run = execute;

    contents.push({ role: "model", parts });
    contents.push({
      role: "user",
      parts: await Promise.all(
        requested.map(async (call) => {
          const args = call.args ?? {};
          calls.push({ name: call.name, args });
          return {
            functionResponse: { name: call.name, response: await runSafely(run, { name: call.name, args }) },
          };
        }),
      ),
    });
  }
}

/// A thrown tool goes back to the model as data, not as a 500 — "that project
/// has no references yet" is something the director needs told, and the model
/// is the thing holding the conversation.
async function runSafely(execute: ToolExecutor, call: ToolCall) {
  try {
    return await execute(call);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

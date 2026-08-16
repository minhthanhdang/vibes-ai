import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContent,
  textOf,
  type Content,
  type FunctionDeclaration,
} from "@/server/google/vertex";

/// tech-spec §III.6: the orchestrator routes, it never searches itself. Agent
/// 1 is reached as a tool call here rather than an ADK `sub_agents` transfer —
/// the Agent Engine deployment does not exist yet, and routing one phrase to
/// one tool does not need one.
const SYSTEM_INSTRUCTION = `You are the orchestrator of a film director's reference assistant.

The director talks to you in plain language about the look they are chasing.
When they want reference imagery, call search_references. Never invent image
URLs, never describe images you have not been given — the tool result is the
only thing that actually reaches their project.

The tool searches stock photo libraries, so pass a short visual phrase, not the
director's sentence. "I need to find reference for a gloomy historical mansion"
becomes "gloomy historical mansion". Keep subject and mood, drop the framing
words. If they ask for several distinct looks, make one call per look.

After the tool returns, reply in one or two sentences: what you searched for and
how many images landed in the project. If the tool reports an error, say plainly
what is missing instead of pretending it worked. When no search is needed, just
answer.`;

export const SEARCH_REFERENCES: FunctionDeclaration = {
  name: "search_references",
  description:
    "Search freely licensed stock photo libraries (Unsplash, Pexels, Google Custom Search) for reference images and add them to the current project. Returns the images that were added, with their credits.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Short visual search phrase — subject, mood, setting. e.g. 'gloomy historical mansion'.",
      },
      limit: {
        type: "integer",
        description: "How many images to add. Default 12, max 40.",
      },
      orientation: {
        type: "string",
        enum: ["landscape", "portrait", "square"],
        description: "Only set when the director asked for a specific shape.",
      },
    },
    required: ["query"],
  },
};

export type ToolCall = { name: string; args: Record<string, unknown> };
export type ToolExecutor = (call: ToolCall) => Promise<Record<string, unknown>>;

export type Turn = { role: "user" | "model"; text: string };

/// The model gets at most this many tool rounds before we make it answer — a
/// stuck model calling the same search forever is a real failure mode and each
/// round is a live provider search.
const MAX_TOOL_ROUNDS = 3;

export async function orchestrate({
  message,
  history = [],
  execute,
}: {
  message: string;
  history?: Turn[];
  execute: ToolExecutor;
}) {
  const contents: Content[] = [
    ...history.map(({ role, text }) => ({ role, parts: [{ text }] })),
    { role: "user" as const, parts: [{ text: message }] },
  ];
  const calls: ToolCall[] = [];

  for (let round = 0; ; round++) {
    const response = await generateContent(MODELS.PRO, contents, {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations: [SEARCH_REFERENCES] }],
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);

    if (!requested.length || round >= MAX_TOOL_ROUNDS) {
      return { reply: textOf(parts) || "…", calls };
    }

    contents.push({ role: "model", parts });
    contents.push({
      role: "user",
      parts: await Promise.all(
        requested.map(async (call) => {
          const args = call.args ?? {};
          calls.push({ name: call.name, args });
          return {
            functionResponse: { name: call.name, response: await runSafely(execute, { name: call.name, args }) },
          };
        }),
      ),
    });
  }
}

/// A thrown tool goes back to the model as data, not as a 500 — "no image
/// provider configured" is something the director needs told, and the model is
/// the thing holding the conversation.
async function runSafely(execute: ToolExecutor, call: ToolCall) {
  try {
    return await execute(call);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

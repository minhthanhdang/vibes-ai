import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContent,
  textOf,
  type Content,
  type FunctionDeclaration,
} from "@/server/google/vertex";
import { mergedAttachments, type ChatAttachment, type ToolOutcome } from "@/lib/agent-tools";
import { NO_USAGE, addUsage, usageOf } from "@/lib/model-cost";

/// tech-spec §III.6: the orchestrator routes, it never does the work itself.
/// Agents 2–5 arrive as tool calls here rather than as an ADK `sub_agents`
/// transfer — the Agent Engine deployment does not exist yet.
const SYSTEM_INSTRUCTION = `You are the orchestrator of a film director's reference assistant.

The director talks to you in plain language about the look they are chasing.
Help them articulate it: palette, lighting, texture, composition, subject,
contrast and depth are the vocabulary the rest of the pipeline works in, so
reflect their description back in those terms and ask about the ones they left
open.

The project's pictures are the director's own uploads, and your tools are the
only way to see them. Call list_references before you say anything about what is
in the project — never guess at a title, a count or a look you have not read.
When you talk about particular references, call show_references so the director
sees them beside your reply; a name in prose is not a picture. Every id you pass
must be one a tool gave you.

When the director wants part of a frame — a tighter shot, the subject alone, this
one at scope — call crop_reference on that one reference. It does not cut
anything: the offer appears beside your reply and they take it or leave it in the
picture's properties panel. So say what the cut keeps and leave the decision with
them, never that you have cropped or saved anything. Crop when a cut is asked
for, on the frame it is about, and if several would do then ask which.

When the director asks for a moodboard, call compose_moodboard: name the
references that make the argument, say what the board is for, and give it a line
or two of text if the board wants a title on it. It files a real board they can
open and rearrange, so make one when one is asked for and not to illustrate a
point. What comes back says what was left off and what did not fit — say so
plainly rather than describing a board that is fuller than the one they have.

You cannot fetch, search or edit images. If they ask for that, say plainly that
references come from their own uploads. Never invent image URLs and never
describe images you have not been given.

Keep replies to a few sentences.`;

export type ToolCall = { name: string; args: Record<string, unknown> };
export type ToolExecutor = (call: ToolCall) => Promise<ToolOutcome>;

export type Turn = { role: "user" | "model"; text: string };

/// The model gets at most this many tool rounds before we make it answer — a
/// stuck model calling the same tool forever is a real failure mode.
const MAX_TOOL_ROUNDS = 3;

/// What the director is told when the loop stops a model that was still asking
/// for tools. It has written no text on that round — it was mid-call — so
/// without this the reply is the empty-parts fallback, and a bubble reading "…"
/// under three thumbnails is the assistant appearing to have nothing to say
/// about pictures it just went and fetched.
export const STUCK_REPLY =
  "I had a look but ran out of steps before I could answer properly — ask me again and I will pick up from what is above.";

export async function orchestrate({
  message,
  history = [],
  tools = [],
  execute,
  /// The model call, injected — the same seam agents 3 and 4 have. Every round
  /// of this loop is a call with the whole conversation in it, so the thing most
  /// worth asserting about the orchestrator is how many rounds it buys, and that
  /// cannot be asserted by anything that has to reach Vertex to ask.
  generate = generateContent,
}: {
  message: string;
  history?: Turn[];
  tools?: FunctionDeclaration[];
  execute?: ToolExecutor;
  generate?: typeof generateContent;
}) {
  const contents: Content[] = [
    ...history.map(({ role, text }) => ({ role, parts: [{ text }] })),
    { role: "user" as const, parts: [{ text: message }] },
  ];
  const calls: ToolCall[] = [];
  /// What the tools put in front of the director this turn, gathered across
  /// every round: a model that lists the gallery, then shows three of it, has
  /// answered once and the chat draws one reply.
  let attachments: ChatAttachment[] = [];
  /// Every round re-sends the whole conversation, tool results and all, so a
  /// three-round turn is not three times a one-round turn — it is closer to six.
  /// This is the number that makes `MAX_TOOL_ROUNDS` a measured ceiling rather
  /// than a guessed one. Only the orchestrator's own calls: the agents it calls
  /// through tools write their own rows, and adding theirs here would bill the
  /// project twice for one crop.
  let usage = NO_USAGE;

  for (let round = 0; ; round++) {
    const response = await generate(MODELS.PRO, contents, {
      systemInstruction: SYSTEM_INSTRUCTION,
      // An empty `functionDeclarations` array is not the same as no tools —
      // Vertex rejects it — so the key is omitted entirely when none are given.
      ...(tools.length && { tools: [{ functionDeclarations: tools }] }),
    });

    usage = addUsage(usage, usageOf(response));

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);

    if (!execute || !requested.length || round >= MAX_TOOL_ROUNDS) {
      /// Only the round cap earns the stuck sentence. A model calling a tool
      /// nobody gave it an executor for is a wiring fault, not a turn that ran
      /// out of steps, and telling the director to ask again would be a lie.
      const exhausted = round >= MAX_TOOL_ROUNDS && requested.length > 0;
      return {
        reply: textOf(parts) || (exhausted ? STUCK_REPLY : "…"),
        calls,
        attachments,
        model: MODELS.PRO,
        usage,
      };
    }
    const run = execute;

    const outcomes = await Promise.all(
      requested.map(async (call) => {
        const args = call.args ?? {};
        calls.push({ name: call.name, args });
        return { name: call.name, outcome: await runSafely(run, { name: call.name, args }) };
      }),
    );

    for (const { outcome } of outcomes) {
      attachments = mergedAttachments(attachments, outcome.attachments ?? []);
    }

    contents.push({ role: "model", parts });
    contents.push({
      role: "user",
      parts: outcomes.map(({ name, outcome }) => ({
        functionResponse: { name, response: outcome.result },
      })),
    });
  }
}

/// A thrown tool goes back to the model as data, not as a 500 — "that project
/// has no references yet" is something the director needs told, and the model
/// is the thing holding the conversation.
async function runSafely(execute: ToolExecutor, call: ToolCall): Promise<ToolOutcome> {
  try {
    return await execute(call);
  } catch (cause) {
    return { result: { error: cause instanceof Error ? cause.message : String(cause) } };
  }
}

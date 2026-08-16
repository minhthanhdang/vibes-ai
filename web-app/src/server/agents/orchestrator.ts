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
import { emptyReply, finishReasonOf, retryableEmpty } from "@/lib/model-finish";

/// tech-spec §III.6: the orchestrator routes, it never does the work itself.
/// Agents 2–5 arrive as tool calls here rather than as an ADK `sub_agents`
/// transfer — the Agent Engine deployment does not exist yet.
const SYSTEM_INSTRUCTION = `You are the orchestrator of a film director's reference assistant.

The director talks to you in plain language about the look they are chasing.
Help them articulate it: palette, lighting, texture, composition, subject,
contrast and depth are the vocabulary the rest of the pipeline works in, so
reflect their description back in those terms and ask about the ones they left
open.

The project's pictures are the director's own uploads. They are listed at the end
of these instructions, read fresh for this message: that list is the project, and
every id in it is one you may pass to a tool. Talk about the references from it
and never guess at a title, a count or a look that is not there. It is the
photographs only — call list_references with includeCrops when the cuts made of
them matter as well. When you talk about particular references, call
show_references so the director sees them beside your reply; a name in prose is
not a picture.

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

The boards they already have are listed with the pictures at the end of these
instructions. When they mean one of those — lay it out again, make it a grid,
swap a picture on it — pass its id as boardId and it is rebuilt in place rather
than filed beside the one they were talking about; leave referenceIds out to keep
the pictures it already holds. Each line ends with the template that board was
composed at, and a rebuild keeps it unless the pictures no longer fit — so pass a
layout only when they asked for a different shape of board, and tell them if the
answer says its shape had to change. The list does not say which pictures are on a
board: call inspect_board for that, which reads it and shows it beside your reply
without changing anything. Do that whenever they ask what is on a board, or point
at one of its pictures by position, and never rebuild a board to find out what it
holds. When they want a picture put on or taken off, name only that one in
addReferenceIds or removeReferenceIds — listing the whole board in referenceIds
would drop every picture you could not name. When they want one picture *in the
place of* another — a cut they have just taken going on instead of the frame it
came from — call swap_on_board rather than rebuilding: it puts the new picture
where the old one was and leaves the rest of the board untouched, which a rebuild
cannot promise. A new board every time is a tab row they have to
tidy up after you. A rebuild replaces what was on that board, arrangement and
all, so say that it is the same board laid out again — and if they may have
arranged it by hand, ask before you rebuild rather than after.

You cannot fetch, search or edit images. If they ask for that, say plainly that
references come from their own uploads. Never invent image URLs and never
describe images you have not been given.

Keep replies to a few sentences.`;

/// The instruction with this project written into it.
///
/// The brief goes in the system instruction rather than into the conversation
/// because it is state, not something anybody said: it is re-read on every turn
/// and the version that matters is the current one, so a copy sitting in the
/// history would be a stale list the model could still quote from.
export function orchestratorInstruction(brief?: string) {
  return brief ? `${SYSTEM_INSTRUCTION}\n\nThe project, as it stands:\n${brief}` : SYSTEM_INSTRUCTION;
}

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
  /// This project's photographs, primed into the instruction. Without it the
  /// model has to buy a round to find out what it is talking about, and a round
  /// is dearer than the list.
  brief,
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
  brief?: string;
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
  const systemInstruction = orchestratorInstruction(brief);

  /// Tool rounds, counted where they are spent rather than per model call: a
  /// round is a *tool result added to the conversation*, and the retry below
  /// adds none, so it must not eat one of these.
  let rounds = 0;
  let retried = false;

  for (;;) {
    const response = await generate(MODELS.PRO, contents, {
      systemInstruction,
      // An empty `functionDeclarations` array is not the same as no tools —
      // Vertex rejects it — so the key is omitted entirely when none are given.
      ...(tools.length && { tools: [{ functionDeclarations: tools }] }),
    });

    usage = addUsage(usage, usageOf(response));

    const finish = finishReasonOf(response);
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);
    const text = textOf(parts);

    if (!execute || !requested.length || rounds >= MAX_TOOL_ROUNDS) {
      /// Nothing at all came back — no sentence, no call. Seen live: the model
      /// asked for two tools in one emission, Vertex could not parse the call and
      /// returned a candidate with no parts. Asking once more is worth a round,
      /// because that failure is the model's own emission rather than a decision
      /// about the message, and the alternative is a turn that cost a round and
      /// said nothing.
      if (!text && !requested.length && retryableEmpty(finish) && !retried) {
        retried = true;
        continue;
      }

      /// Only the round cap earns the stuck sentence. A model calling a tool
      /// nobody gave it an executor for is a wiring fault, not a turn that ran
      /// out of steps, and telling the director to ask again would be a lie.
      const exhausted = rounds >= MAX_TOOL_ROUNDS && requested.length > 0;
      return {
        reply: text || (exhausted ? STUCK_REPLY : requested.length ? "…" : emptyReply(finish)),
        calls,
        attachments,
        model: MODELS.PRO,
        usage,
        /// Why it stopped, when that is not simply "it answered". Carried out so
        /// the turn's run row can hold it: a reply the director was given instead
        /// of an answer should be readable afterwards as what it was.
        finish,
      };
    }
    rounds += 1;
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

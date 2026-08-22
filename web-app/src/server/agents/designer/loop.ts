import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContent,
  textOf,
  type Content,
  type GeneratePart,
} from "@/server/google/vertex";
import type { ToolDeclaration } from "@/lib/agent/agent-tools";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/model-cost";
import { emptyReply, finishReasonOf, retryableEmpty } from "@/lib/agent/model-finish";
import { toolWindow } from "@/lib/agent/tool-window";
import { pictureWindow } from "@/lib/agent/picture-window";
import { designerInstruction } from "@/server/agents/designer/instruction";

/// Agent 8's loop (compositor-v2.md §II, §III.1, §VII).
///
/// The orchestrator's loop next door answers a person: it carries a stored
/// conversation, it puts thumbnails in front of the user, and `conversation.ts`
/// is the one assembler of what it sends because the live turn and the record
/// must not drift. This one answers agent 6. There is no record and there is no
/// user — nothing agent 8 draws is ever shown to one — so the transcript is a
/// `Content[]` built here and thrown away, and the only thing that leaves is a
/// sentence and the numbers a run row is made of.
///
/// Everything that makes it different from that loop is a ceiling. Free
/// placement plus a tool loop plus vision has no natural stopping point (§VII),
/// so the rounds are counted, the pictures are counted, and both are said out
/// loud when they run out: a ceiling the model cannot see it has hit is a model
/// that keeps asking and cannot tell why the answers stopped coming.

/// Tool rounds in one `design_page` call (§VII). A page that is not made in
/// twelve is not going to be — §II.6's own discipline is two looks, so twelve
/// is roughly four times the work the instruction asks for.
export const DESIGNER_ROUND_LIMIT = 12;

/// Image parts across the whole call, window or no window (§VII).
///
/// `PICTURE_WINDOW` bounds what a *request* carries; this bounds what the call
/// ever fetches. They are different failures: the window makes a twelve-round
/// turn affordable, and without this a model could still spend all twelve of
/// those rounds on `get_image`, one picture each, and pay for twelve pictures
/// while never seeing more than two of them at a time.
///
/// Counted as pictures are attached rather than read off the transcript,
/// because the window removes the very parts a live count would look for.
export const DESIGNER_PICTURE_LIMIT = 8;

/// The one tool whose answer the window never drops (§IV.5).
///
/// A skill is what the work is being judged against. Dropping it three rounds
/// in is the agent forgetting the trade halfway through the job — and it is the
/// answer most likely to be dropped, because three skills at
/// `SKILL_CHAR_BUDGET` are most of `TOOL_CHAR_BUDGET` on their own.
export const SKILL_TOOL = "get_skill";

/// What agent 6 is given when the loop stopped the model mid-work.
///
/// `STUCK_REPLY`'s reason, one agent along: the emission that hit the ceiling
/// was a tool call, so it carries no sentence, and without this the closing
/// line would be the empty-parts fallback — agent 6 telling the user nothing
/// about a page that has really been changed.
export const DESIGNER_STUCK_LINE =
  "I ran out of steps before I could finish. What I placed is on the page and nothing was undone — read the page and tell the user what is there, and that it may want another pass.";

export type DesignerCall = { name: string; args: Record<string, unknown> };

/// What one of agent 8's tools answers with: the JSON, and the pictures that go
/// into the transcript beside it.
///
/// `ToolOutcome`'s `attachments` has no counterpart here on purpose. Those are
/// for the chat, and agent 8 has no chat — its pictures are for the model's own
/// eyes and go up as parts (§III), which is a different half of the answer
/// entirely.
export type DesignerOutcome = {
  result: Record<string, unknown>;
  pictures?: GeneratePart[];
};

export type DesignerExecutor = (call: DesignerCall) => Promise<DesignerOutcome>;

/// What stands where a picture the budget would not buy was going to be.
///
/// Said for `pictureDroppedSaid`'s reason and with the opposite ending: that
/// note tells the model a picture is gone and how to get it back, and this one
/// tells it there is no getting it back. A model that asked to look and was
/// quietly handed text is a model describing a page it never saw.
export function pictureCeilingSaid(name: string | undefined, refused: number): string {
  const which = name ? `${name} returned` : "an earlier call returned";
  const more = refused === 1 ? "" : ` (${refused} pictures so far this call)`;
  return `[The picture ${which} is not shown: this design has already looked at ${DESIGNER_PICTURE_LIMIT} pictures, which is all one may${more}. The answer's words are all of it. Work from what you have already seen, and say plainly in your closing line if you had to place something you could not look at.]`;
}

/// One model turn and the answers to it, as the transcript holds them.
type Round = { call: Content; result: Content; pinned: boolean };

/// The request for one round: the ask, the skill rounds pinned above the work,
/// and what is left of the work after both windows.
///
/// The pin is a slice rather than a rule inside `toolWindow`, because it is not
/// really a window question. A skill is priming the agent went and bought —
/// the same thing the orchestrator's brief is, which rides in the system
/// instruction for exactly this reason — and priming belongs at the head of a
/// transcript, above the work, where no window reaches. `get_skill` is one call
/// per turn and §II.6 has it made first, so in practice this is where the round
/// already stood.
///
/// `toolWindow` before `pictureWindow`, and never the other way round: a round
/// dropped whole is already accounted for by `roundsDroppedSaid`, and a picture
/// note left behind for a round no longer in the request would name a call
/// whose answer the model cannot see.
export function designerRequest(ask: Content, rounds: readonly Round[]) {
  const pinned = rounds.filter((round) => round.pinned);
  const rest = rounds.filter((round) => !round.pinned);

  const windowed = toolWindow([ask, ...rest.flatMap(({ call, result }) => [call, result])]);
  const [head, ...kept] = windowed.contents;
  const pictures = pictureWindow([
    head!,
    ...pinned.flatMap(({ call, result }) => [call, result]),
    ...kept,
  ]);

  return {
    contents: pictures.contents,
    roundsDropped: windowed.dropped,
    picturesDropped: pictures.dropped,
  };
}

export type DesignerAnswer = {
  /// Agent 8's own closing line, which agent 6 says to the user in fewer words
  /// (§VI) — the way agent 4's `note` rides out of `compose_moodboard`.
  line: string;
  calls: DesignerCall[];
  model: string;
  usage: TokenUsage;
  /// The shape of the spend beside its size, for the `AgentKind.DESIGNER` row
  /// the caller writes. A loop priced per model call and never per turn is a
  /// loop nobody can see getting longer (§VII), and these are the numbers that
  /// make a long one readable afterwards as one.
  rounds: number;
  roundsDropped: number;
  modelCalls: number;
  /// Pictures the loop attached, pictures the window took out of the last
  /// request, and pictures the budget refused. The third is the one worth a
  /// column: it is the only case where the model answered about a page it asked
  /// to see and was not shown.
  pictures: number;
  picturesDropped: number;
  picturesRefused: number;
  finish?: string;
  /// Why it stopped, when that is not "it answered". A design that hit the
  /// round ceiling really did change the board, so this is not a failure — it
  /// is the difference between a page that is finished and one that was left
  /// mid-pass.
  stopped?: "rounds";
};

export async function runDesigner({
  /// What agent 6's `design_page` args come to in words — the board, the page,
  /// the intention, the pictures it named. Built by the door rather than here:
  /// this loop's business is the rounds, and the ask is the door's own reading
  /// of a call it validated.
  ask,
  instruction = designerInstruction(),
  tools = [],
  execute,
  /// The model call, injected — the same seam every agent in this directory
  /// has. Every round is a call with the whole transcript in it, so what is
  /// worth asserting about this loop is how many rounds and how many pictures
  /// it buys, and neither can be asserted by anything that has to reach Vertex.
  generate = generateContent,
}: {
  ask: string;
  instruction?: string;
  tools?: ToolDeclaration[];
  execute?: DesignerExecutor;
  generate?: typeof generateContent;
}): Promise<DesignerAnswer> {
  const askContent: Content = { role: "user", parts: [{ text: ask }] };
  const rounds: Round[] = [];
  const calls: DesignerCall[] = [];

  let usage = NO_USAGE;
  let modelCalls = 0;
  let roundsDropped = 0;
  let picturesDropped = 0;
  let pictures = 0;
  let picturesRefused = 0;
  let retried = false;

  for (;;) {
    const sent = designerRequest(askContent, rounds);
    roundsDropped = sent.roundsDropped;
    picturesDropped = sent.picturesDropped;
    modelCalls += 1;

    const response = await generate(MODELS.FLASH, sent.contents, {
      systemInstruction: instruction,
      // An empty `functionDeclarations` array is not the same as no tools —
      // Vertex rejects it — so the key is omitted entirely when none are given.
      ...(tools.length && { tools: [{ functionDeclarations: tools }] }),
    });

    usage = addUsage(usage, usageOf(response));

    const finish = finishReasonOf(response);
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);
    const text = textOf(parts);
    const spent = rounds.length >= DESIGNER_ROUND_LIMIT;

    if (!execute || !requested.length || spent) {
      /// Nothing at all came back — no sentence, no call — and the reason is
      /// the model's own emission failing to parse rather than a decision
      /// about the ask. `orchestrate`'s retry, for its reason: the alternative
      /// is a design that cost a round and said nothing.
      if (!text && !requested.length && retryableEmpty(finish) && !retried) {
        retried = true;
        continue;
      }

      /// Only the ceiling earns the stuck line. A model calling a tool with no
      /// executor behind it is a wiring fault, and telling agent 6 the work ran
      /// long would have it tell the user something that never happened.
      const exhausted = spent && requested.length > 0;
      return {
        line: text || (exhausted ? DESIGNER_STUCK_LINE : emptyReply(finish)),
        calls,
        model: MODELS.FLASH,
        usage,
        rounds: rounds.length,
        roundsDropped,
        modelCalls,
        pictures,
        picturesDropped,
        picturesRefused,
        ...(finish && { finish }),
        ...(exhausted && { stopped: "rounds" as const }),
      };
    }

    const run = execute;
    const outcomes = await Promise.all(
      requested.map(async ({ name, args = {} }) => {
        calls.push({ name, args });
        return { name, outcome: await runSafely(run, { name, args }) };
      }),
    );

    /// Each picture directly before the `functionResponse` it belongs to, never
    /// in a lump at the end of the round, and never after the last response.
    ///
    /// Two rules, and the second one is the API's rather than this loop's.
    /// `pictureWindow` reads ownership positionally, so a round of two `get_`
    /// calls whose pictures were appended together would produce two notes both
    /// naming the first call — a lie about which call brings the picture back.
    /// And Vertex refuses a `functionResponse` turn whose trailing part is not
    /// itself a response: verified live, a turn of `[response, picture]` comes
    /// back 400 "Requests ending with a model turn are not supported" while
    /// `[picture, response]` and `[response, picture, response]` are both taken.
    /// The error names the wrong thing, which is why this is written down here:
    /// the turn ends with the user, and what Vertex will not read is the tail.
    const answers: GeneratePart[] = [];
    for (const { name, outcome } of outcomes) {
      for (const picture of outcome.pictures ?? []) {
        /// Counted here and nowhere else: the window below will remove these
        /// parts from the transcript, so a budget that read the live request
        /// would be reading the number this one exists to bound.
        if (pictures >= DESIGNER_PICTURE_LIMIT) {
          picturesRefused += 1;
          answers.push({ text: pictureCeilingSaid(name, picturesRefused) });
          continue;
        }
        pictures += 1;
        answers.push(picture);
      }
      answers.push({ functionResponse: { name, response: outcome.result } });
    }

    rounds.push({
      /// The emission verbatim. It carries fields the wire models and this
      /// loop does not read, and the next round has to return them untouched.
      call: { role: "model", parts },
      /// Re-roled to `user`, which is the only reason the role flips: Vertex
      /// rejects a `functionResponse` with no call above it. Same rule
      /// `conversation.ts` states for the loop next door.
      result: { role: "user", parts: answers },
      pinned: outcomes.some(({ name }) => name === SKILL_TOOL),
    });
  }
}

/// A thrown tool goes back to the model as data, not as a 500 — "that page is
/// not on that board" is something the model can act on, and it is the thing
/// holding the work.
async function runSafely(execute: DesignerExecutor, call: DesignerCall): Promise<DesignerOutcome> {
  try {
    return await execute(call);
  } catch (cause) {
    return { result: { error: cause instanceof Error ? cause.message : String(cause) } };
  }
}

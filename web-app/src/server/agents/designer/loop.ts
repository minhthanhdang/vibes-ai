import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContentStream,
  textOf,
  type Content,
  type GeneratePart,
} from "@/server/google/vertex";
import { emit, watchedBy } from "@/server/agents/shared/agent-scope";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { emptyReply, finishReasonOf, retryableEmpty } from "@/lib/agent/shared/model-finish";
import { toolWindow } from "@/lib/agent/shared/tool-window";
import { pictureWindow } from "@/lib/agent/designer/picture-window";
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
///
/// Measured over the 32 designs on the development database
/// (`npm run design:runs`): mean 6.2 rounds, and 3 of 30 designs reached the
/// twelfth, 2 of them stopped mid-work by it. This is the binding ceiling of
/// the two — see `DESIGNER_PICTURE_LIMIT`, which has never been reached — and
/// the runs it stops are the ones that spend their last rounds nudging a page
/// with `transform_on_canvas` rather than the ones with more work to do.
///
/// Re-read at 47 designs, once "Let's Vibes" had put real six-page runs through
/// it: mean 7.0 rounds, **11 at the limit and 8 stopped mid-work by it**. What
/// changed is not the loop but who calls it — agent 6's designs arrive one at a
/// time from a person who then says the next thing, and a Vibes page arrives
/// with the whole ask in one sentence and nothing after it. So the number that
/// moved is not evidence for a bigger ceiling; it is evidence the model was
/// spending rounds it did not know it was running out of, which is what
/// `DESIGNER_ROUNDS_WARNED` below answers. Read this census again before
/// touching the twelve, and read it after a run of designs that saw the
/// countdown rather than before.
export const DESIGNER_ROUND_LIMIT = 12;

/// Image parts across the whole call, window or no window (§VII).
///
/// `PICTURE_WINDOW` bounds what a *request* carries; this bounds what the call
/// ever fetches. They are different failures: the window makes a twelve-round
/// turn affordable, and without this a model could still spend all twelve of
/// those rounds on `get_image`, one picture each, and pay for twelve pictures
/// while never seeing more than `PICTURE_WINDOW` of them at a time.
///
/// Counted as pictures are attached rather than read off the transcript,
/// because the window removes the very parts a live count would look for.
///
/// §VIII says to watch the `AgentRun` rows before raising it, and the reading
/// (`npm run design:runs`, 32 designs on the development database) says not to
/// touch it in either direction: mean 3.9 pictures, max 7, and **not one
/// picture refused by it, ever**. The failure mode it was written for — a model
/// answering "I should look at these first" every round — has not happened, so
/// there is no case for raising it and no evidence yet that lowering it would
/// cost anything either. `PICTURE_WINDOW` is doing the work: 72 of those 117
/// pictures were dropped out of the transcript rather than never fetched — a
/// reading taken while that window was 2 and undeduped, so it is the reading to
/// take again before this constant is next argued about.
export const DESIGNER_PICTURE_LIMIT = 8;

/// The one tool whose answer the window never drops (§IV.5).
///
/// A skill is what the work is being judged against. Dropping it three rounds
/// in is the agent forgetting the trade halfway through the job — and it is the
/// answer most likely to be dropped, because three skills at
/// `SKILL_CHAR_BUDGET` are most of `TOOL_CHAR_BUDGET` on their own.
export const SKILL_TOOL = "get_skills";

/// What agent 6 is given when the loop stopped the model mid-work.
///
/// `STUCK_REPLY`'s reason, one agent along: the emission that hit the ceiling
/// was a tool call, so it carries no sentence, and without this the closing
/// line would be the empty-parts fallback — agent 6 telling the user nothing
/// about a page that has really been changed.
export const DESIGNER_STUCK_LINE =
  "I ran out of steps before I could finish. What I placed is on the page and nothing was undone — read the page and tell the user what is there, and that it may want another pass.";

/// What the model is asked when the loop is about to return a line it never
/// wrote.
///
/// Two endings reach `DESIGNER_STUCK_LINE` and `emptyReply` — the ceiling
/// biting on a tool call, and an emission with nothing in it — and both of them
/// hand agent 6 a sentence agent 8 did not say about a page agent 8 really
/// changed. The page is the one thing in the turn nothing else watched happen
/// (§VI), so a canned line there is the user being told about their own board
/// by a string constant.
///
/// So one more call, with the same windowed transcript and no tools on it at
/// all: there is nothing left for the model to *do*, and Vertex rejects an
/// empty `functionDeclarations` rather than reading it as none. It costs one
/// FLASH call on the runs that hit the ceiling — 8 of 47 by the census on
/// `DESIGNER_ROUND_LIMIT` — and it buys the only account of the page that comes
/// from the agent that made it.
export const DESIGNER_CLOSING_ASK =
  "[This design is over — nothing further will be placed, and no tool is offered on this turn. Say in one or two sentences what you put on the page and what it still wants. This is the whole of what the user is told about it, so describe the page rather than the work you did on it.]";

/// Rounds left when the model is first told how many it has (§VII).
///
/// The picture ceiling is said out loud the round it bites (`pictureCeilingSaid`)
/// and the round window says what it took (`roundsDroppedSaid`); the round
/// ceiling was the one budget in this loop the model only learned about
/// afterwards, from a stuck line it never reads. `npm run design:runs` over 47
/// designs says that is not a rare corner: 11 reached the twelfth round and 8
/// were stopped mid-work by it, and one page of the six-page run in
/// `compositor-v2.md` §IX.4 spent all twelve reading and called
/// `put_on_canvas` not once.
///
/// Three, because §II.6's discipline is make, look, fix — a warning that
/// arrives with less than that left arrives after the last round it could have
/// changed anything, which is the same as not arriving. It is said again each
/// round after, because a countdown told once is a fact the model read eight
/// thousand tokens ago.
export const DESIGNER_ROUNDS_WARNED = 3;

/// What the model is told as the rounds run out (§VII).
///
/// Two things it cannot work out for itself and both change what it does next.
/// That a round is a *turn* and not a call is the first: `put_on_canvas` is
/// batched to ten and a model spending its last three rounds placing one
/// element each is a model that had thirty and used three. And that the last
/// emission is what the user is told is the second — a design that ends on a
/// tool call ends on `DESIGNER_STUCK_LINE`, which is agent 6 apologising for a
/// page rather than the model saying what it made.
export function roundsLeftSaid(left: number): string {
  if (left <= 0) {
    return `[No more tool calls will run on this design: all ${DESIGNER_ROUND_LIMIT} steps are spent. Whatever you say next is the whole of what the user is told, so say what you made and what it still wants — a call here reaches nothing and is not placed.]`;
  }
  const steps = left === 1 ? "one more step" : `${left} more steps`;
  return `[You have ${steps} on this design and then no more — ${DESIGNER_ROUND_LIMIT} is all one design gets. A step is one turn however many calls you put in it, so place everything still missing in the same turn rather than one thing at a time. If the page is made, stop now and say what you made.]`;
}

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
/// transcript, above the work, where no window reaches. §II.6 has the skills
/// read first, so in practice this is where the round already stood.
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

/// The closing call's contents: the round's own request with the ask appended
/// as a user part.
///
/// The same window as every other round, for the plain reason that this call is
/// about the same work — a closing line written off a transcript the model has
/// not been shown is a description of a page it cannot see. Appended as a part
/// of its own rather than folded into the last `functionResponse` turn, because
/// the last turn may be the model's and Vertex will not read a request that
/// ends on one.
export function closingRequest(ask: Content, rounds: readonly Round[]): Content[] {
  const { contents } = designerRequest(ask, rounds);
  return [...contents, { role: "user", parts: [{ text: DESIGNER_CLOSING_ASK }] }];
}

export type DesignerAnswer = {
  /// Agent 8's own closing line, which agent 6 says to the user in fewer words
  /// (§VI). Its own on every ending: when the model did not write one, the loop
  /// buys a tool-less round and asks for it (`DESIGNER_CLOSING_ASK`) rather than
  /// handing back a constant.
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
  generate = generateContentStream,
}: {
  ask: string;
  instruction?: string;
  tools?: ToolDeclaration[];
  execute?: DesignerExecutor;
  generate?: typeof generateContentStream;
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

    const response = await generate(
      MODELS.FLASH,
      sent.contents,
      {
        systemInstruction: instruction,
        ...(tools.length && { tools: [{ functionDeclarations: tools }] }),
        thinkingConfig: { includeThoughts: true },
      },
      watchedBy(),
    );

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

      /// One more call rather than a constant, whenever the model has not
      /// written the closing line itself (`DESIGNER_CLOSING_ASK`). Its usage
      /// folds into the total and it counts as a model call, because it is
      /// one — and it is not a round, because nothing was done in it.
      let line = text;
      if (!line) {
        const closing = await generate(MODELS.FLASH, closingRequest(askContent, rounds), {
          systemInstruction: instruction,
        });
        usage = addUsage(usage, usageOf(closing));
        modelCalls += 1;
        line = textOf(closing.candidates?.[0]?.content?.parts ?? []);
      }

      return {
        /// The constants survive as the fallback for the closing call coming
        /// back as empty as the round that provoked it.
        line: line || (exhausted ? DESIGNER_STUCK_LINE : emptyReply(finish)),
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

    /// Before the tools are awaited, for agent 6's reason: a `put_on_canvas`
    /// that takes half a minute should be a step on screen while it takes it.
    /// The `callId`s are this loop's own numbering — agent 8's calls are not
    /// stored as `call` parts (they happen inside agent 6's one `design_page`
    /// call), so unlike agent 6's these name nothing a row will hold.
    emit({
      kind: "calling",
      calls: requested.map(({ name, args = {} }, at) => ({
        callId: `${modelCalls}.${at + 1}`,
        name,
        args,
      })),
    });

    const outcomes = await Promise.all(
      requested.map(async ({ name, args = {} }) => {
        calls.push({ name, args });
        return { name, outcome: await runSafely(run, { name, args }) };
      }),
    );

    emit({
      kind: "called",
      results: outcomes.map(({ name, outcome }, at) => ({
        callId: `${modelCalls}.${at + 1}`,
        name,
        ok: !("error" in outcome.result),
      })),
    });

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

    /// The rounds left, at the head of the results rather than after them.
    ///
    /// The tail is where it would be read best and is the one place it cannot
    /// go — the rule two paragraphs up is the API's, and a `[note]` after the
    /// last `functionResponse` is the 400 that rule describes. So it stands
    /// where the model reads the round's answers from, which is also where the
    /// window's own note stands when a round is dropped.
    ///
    /// Counted against the round about to be pushed, not the one just sent:
    /// what is left is what the model may still *do*, and the turn it is being
    /// told about is already spent by the time it reads this.
    const left = DESIGNER_ROUND_LIMIT - (rounds.length + 1);
    if (left <= DESIGNER_ROUNDS_WARNED) answers.push({ text: roundsLeftSaid(left) });

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

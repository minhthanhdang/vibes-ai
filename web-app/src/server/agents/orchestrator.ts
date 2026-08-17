import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContent,
  textOf,
  type Content,
  type FunctionDeclaration,
  type GeneratePart,
} from "@/server/google/vertex";
import {
  mergedAttachments,
  type ChatAttachment,
  type ProjectState,
  type ToolOutcome,
} from "@/lib/agent/agent-tools";
import { NO_USAGE, addUsage, usageOf } from "@/lib/agent/model-cost";
import { emptyReply, finishReasonOf, retryableEmpty } from "@/lib/agent/model-finish";

/// tech-spec §III.6: the orchestrator routes, it never does the work itself.
/// Agents 2–5 arrive as tool calls here rather than as an ADK `sub_agents`
/// transfer — the Agent Engine deployment does not exist yet.
/// Written in sections rather than as one block, because a paragraph about a
/// tool the project cannot use is the same waste as the tool's own declaration —
/// paid on every round of every turn. `orchestratorInstruction` assembles the
/// ones this project has something for; see `orchestratorTools`, which gates the
/// declarations on exactly the same three counts so the instruction never
/// describes a call the model has not been given.
const ROLE = `You are the orchestrator of a film director's reference assistant.

The director talks to you in plain language about the look they are chasing.
Help them articulate it: palette, lighting, texture, composition, subject,
contrast and depth are the vocabulary the rest of the pipeline works in, so
reflect their description back in those terms and ask about the ones they left
open.`;

const PICTURES = `The project's pictures are the director's own uploads. They are listed at the end
of these instructions, read fresh for this message: that list is the project, and
every id in it is one you may pass to a tool. Talk about the references from it
and never guess at a title, a count or a look that is not there. When you talk
about particular references, call show_references so the director sees them
beside your reply; a name in prose is not a picture.`;

/// Only when cuts exist. The list at the end of the instruction is the
/// photographs; `list_references` is for what priming cannot carry, so on a
/// project nobody has cropped it is a round spent to be told what the model
/// already has.
const CUTS = `The list is the photographs only — call list_references with includeCrops when
the cuts made of them matter as well.`;

const CROPPING = `When the director wants part of a frame — a tighter shot, the subject alone, this
one at scope — call crop_reference on that one reference. It does not cut
anything: the offer appears beside your reply and they take it or leave it in the
picture's properties panel. So say what the cut keeps and leave the decision with
them, never that you have cropped or saved anything. Crop when a cut is asked
for, on the frame it is about, and if several would do then ask which.`;

/// Only when boards exist: a cut cannot be made for a slot on a board nobody has
/// composed yet.
const CROPPING_FOR_A_BOARD = `When the cut is meant to fill a slot on a board, pass that board as boardId:
the cut is then held to that slot's exact shape rather than to the format you
named, and taking it also puts it in that picture's place there — so tell them
accepting it is all it needs and do not swap it on afterwards.`;

const COMPOSING = `When the director asks for a moodboard, call compose_moodboard: name the
references that make the argument, say what the board is for, and give it a line
or two of text if the board wants a title on it. It files a real board they can
open and rearrange, so make one when one is asked for and not to illustrate a
point. What comes back says what was left off and what did not fit — say so
plainly rather than describing a board that is fuller than the one they have.`;

/// Only when boards exist. This is the longest section in the file and every
/// sentence of it is about an id the model has not been given until the project
/// has a board — which is why it is the one most worth gating.
const BOARDS = `The boards they already have are listed with the pictures at the end of these
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
would drop every picture you could not name — and pass the pageId of the page it
goes on or comes off, because a picture is put on a *page* and one on another page
of the same board is not there to be taken off. A board is one or more pages, each a
fixed rectangle with a name of its own: inspect_board lists them and reads one of
them alone, and compose_moodboard lays one of them out — pass the pageId of the
page they are talking about, or leave it out on a board of one page. A board's
line says how many pages it is on when it is on more than one and what those
pages are called, and a line that says nothing about pages is a board of one
page — so when they name a page and no board, the board whose line carries that
page name is the board they mean, and on any board the list calls a spread, read
it with inspect_board to learn which page they mean and get its pageId before you
change any part of it, and never let a page-scoped call fall back to its first
page on a board you have not read. Reading a
page also says where each thing on it sits, so answer "the one on the left", "the
big one" and "what is under the headline" off that page read rather than
guessing or laying the page out again to find out. When they
want *another* page — the exteriors on a page of their own, a second page for the
night work — pass newPage with the references that go on it and it is added
beside what the board already has, which is the only call that leaves everything
on the board standing and still gives them somewhere new to put pictures. When
they want the page *empty* — somewhere to drag pictures to, or a page at all on a
board they arranged by hand and do not want laid out again — call add_page
instead: it draws the rectangle and nothing else, and on a board with no pages it
draws the first one around the pictures already there so that board can be read
and composed a page at a time from then on. A page is called Page 1, Page 2
until somebody names it, so name a page whenever the director called it
something of their own — add_page takes the name it is drawn with, and
compose_moodboard takes pageName, which names the page newPage adds and renames
the page a pageId points at. Do it the moment they call it something: that name
is what both of you say the page by afterwards. The
lines of text on a board work
the same way: it keeps them on a rebuild, so add a line with addCaptions or take
one off with removeCaptions, and pass captions only when they want every line
replaced. To change what a line already on the board *says* — a typo, a different
word, the same headline in other words — call reword_on_board instead: it rewrites
the words in place and moves nothing, where taking the old line off and putting a
new one on is a rebuild that reflows the board. When
they only want a board *called* something else, pass boardId and title and
nothing else: that renames it and leaves the arrangement exactly as it is. When they want one picture *in the
place of* another — a cut they have just taken going on instead of the frame it
came from — call swap_on_board rather than rebuilding: it puts the new picture
where the old one was and leaves the rest of the board untouched, which a rebuild
cannot promise. The same call moves pictures *around* a board they are already
on: name the two and they trade places, so "swap those two" and "put that one
where the wide shot is" are never a rebuild either. Both of those free edits take
a pageId as well, and on a board of more than one page you pass it: the same
photograph is on two pages of a spread as often as not and a template puts the
same heading on each, so without a page the picture exchanged or the line
rewritten is whichever copy the board carries first — which may be a page they
are not talking about. A new board every time is a tab row they have to
tidy up after you. A rebuild replaces what was on that board, arrangement and
all, so say that it is the same board laid out again — and if they may have
arranged it by hand, ask before you rebuild rather than after. Adding and removing
is the exception: everything already on the board keeps its place and only the
picture or the line they named moves, so those calls never need asking about. When
they want to try something *without losing* the board they have — another version
of it, a variant, "keep that one and try it with the tall shot" — call
duplicate_board first and make the change on the copy: it costs nothing, copies
the arrangement exactly and leaves the original alone, where every other call here
changes the board they are looking at. When they want a board *gone* — bin it,
delete it, they do not need that version any more — call discard_board on the one
they named. You cannot delete a board and that call does not either: it puts the
board in front of them with a Discard button and they press it or they do not, so
tell them what is on the board they would be losing and that it cannot be undone,
and never say it has gone until they say they have done it. Offer the board they
asked about and no others. When what they want gone is one *page* of a board and
not the board — lose the second page, bin the page you just added, they do not
need the exteriors any more — call discard_page with that page's id instead: it
offers the same way, and what they would lose is that page and the photographs
standing on it while the board and its other pages stay. Do not offer the board
when they asked about a page: discarding the board takes the pages they asked to
keep. Say
what happened rather than what you asked for — the answer tells you whether the
board was laid out again or whether one picture joined an arrangement nothing else
moved in.`;

/// Three sentences rather than a paragraph: the tool's own description carries
/// the routing, which is read before the call and costs nothing extra. What is
/// here is the part a description cannot say, because it is about what the reply
/// claims rather than about which call to make.
const REMOVING = `When they want a picture *out of the project* — bin that one, delete the blurry
frame — call discard_reference on the one they named. You cannot delete a picture
and that call does not either: it puts the picture in front of them with a Remove
button and they press it or they do not, so say what would go with it and never
that it has gone until they say they have done it. Taking a picture off a board
while keeping it in the project is a different thing and never this call.`;

/// What stands in for all of the above on a project with nothing in it. The
/// director talking about the look before they have uploaded anything is a real
/// turn, and it should not carry the prose of five tools none of which can act.
const NOTHING_UPLOADED = `Nothing has been uploaded to this project yet, so there is nothing to show, cut
or compose. Help them describe the look they are after, and tell them the
references come from their own uploads — the gallery is where they add them.`;

const LIMITS = `You cannot fetch, search or edit images. If they ask for that, say plainly that
references come from their own uploads. Never invent image URLs and never
describe images you have not been given.

Keep replies to a few sentences.`;

/// The instruction with this project written into it.
///
/// The brief goes in the system instruction rather than into the conversation
/// because it is state, not something anybody said: it is re-read on every turn
/// and the version that matters is the current one, so a copy sitting in the
/// history would be a stale list the model could still quote from.
///
/// `state` is that same reading applied to the instructions themselves: with it,
/// the sections describing tools this project has nothing to call them on are
/// left out. Without it, every section stands — a caller that does not know what
/// the project holds gets the full instruction rather than a guess at it.
export function orchestratorInstruction(brief?: string, state?: ProjectState) {
  const pictures = state ? state.photographs + state.crops : 1;
  const crops = state ? state.crops : 1;
  const boards = state ? state.boards : 1;

  const instruction = [
    ROLE,
    ...(pictures > 0 ? [crops > 0 ? `${PICTURES}\n\n${CUTS}` : PICTURES] : [NOTHING_UPLOADED]),
    ...(pictures > 0 ? [boards > 0 ? `${CROPPING}\n\n${CROPPING_FOR_A_BOARD}` : CROPPING] : []),
    ...(pictures > 0 ? [REMOVING] : []),
    ...(pictures > 0 ? [COMPOSING] : []),
    ...(boards > 0 ? [BOARDS] : []),
    LIMITS,
  ].join("\n\n");

  return brief ? `${instruction}\n\nThe project, as it stands:\n${brief}` : instruction;
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
  /// What the director attached to this message, already rendered to parts —
  /// a picture of a page and the page in words (§V.5). Prepended to their own
  /// sentence rather than sent as a turn of its own: it is context they chose
  /// *for* what they are about to say, and a message whose words arrive before
  /// the thing they are about is a question about nothing.
  attached = [],
  history = [],
  /// This project's photographs, primed into the instruction. Without it the
  /// model has to buy a round to find out what it is talking about, and a round
  /// is dearer than the list.
  brief,
  /// What the project holds, so the instruction can leave out the sections about
  /// tools it has nothing to call them on. Same three counts `tools` is gated on.
  state,
  /// The declarations, or a function answering with them. A function because the
  /// set is a function of the project and the project can change *inside* a turn:
  /// the round that files the first board is the round after which the board
  /// tools become callable, and an array captured before the loop would leave
  /// them out until the next message.
  tools = [],
  execute,
  /// The model call, injected — the same seam agents 3 and 4 have. Every round
  /// of this loop is a call with the whole conversation in it, so the thing most
  /// worth asserting about the orchestrator is how many rounds it buys, and that
  /// cannot be asserted by anything that has to reach Vertex to ask.
  generate = generateContent,
}: {
  message: string;
  attached?: GeneratePart[];
  history?: Turn[];
  brief?: string;
  state?: ProjectState;
  tools?: FunctionDeclaration[] | (() => FunctionDeclaration[] | Promise<FunctionDeclaration[]>);
  execute?: ToolExecutor;
  generate?: typeof generateContent;
}) {
  const contents: Content[] = [
    ...history.map(({ role, text }) => ({ role, parts: [{ text }] })),
    /// The attachment and the words are one user turn: two parts and then the
    /// sentence, in that order. Re-sent on every round of the turn like the rest
    /// of the conversation — the model reading a tool result about a board is
    /// still looking at the page it was handed.
    { role: "user" as const, parts: [...attached, { text: message }] },
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
  const systemInstruction = orchestratorInstruction(brief, state);
  const declarations = typeof tools === "function" ? tools : () => tools;

  /// Tool rounds, counted where they are spent rather than per model call: a
  /// round is a *tool result added to the conversation*, and the retry below
  /// adds none, so it must not eat one of these.
  let rounds = 0;
  let retried = false;
  /// Model calls, which is a different number from rounds and the one the bill
  /// is made of: an answering call follows the last round, and a retry buys a
  /// call without buying a round. Every one of them re-sends the instruction,
  /// the declarations, the brief and the conversation so far — measured live at
  /// ~3,800 tokens of base for a turn's first call, so a turn's input is
  /// roughly `calls × base` and nothing about it is cached (Vertex reports no
  /// `cachedContentTokenCount` for `PRO`; see §VI).
  let modelCalls = 0;

  for (;;) {
    /// Resolved per round rather than once: a project that had no boards when
    /// the turn started has one the moment `compose_moodboard` files it.
    const round = await declarations();
    modelCalls += 1;
    const response = await generate(MODELS.PRO, contents, {
      systemInstruction,
      // An empty `functionDeclarations` array is not the same as no tools —
      // Vertex rejects it — so the key is omitted entirely when none are given.
      ...(round.length && { tools: [{ functionDeclarations: round }] }),
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
        /// What the tokens above were spent on. The comment on `usage` has
        /// claimed since iteration 1 that this is what makes `MAX_TOOL_ROUNDS`
        /// a measured ceiling, and until now neither number left the function —
        /// so a turn that cost three calls was indistinguishable on the ledger
        /// from one enormous call.
        rounds,
        modelCalls,
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

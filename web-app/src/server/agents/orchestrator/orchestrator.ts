import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContentStream,
  textOf,
  type GeneratePart,
} from "@/server/google/vertex";
import { emit, watchedBy } from "@/server/agents/shared/agent-scope";
import type { ProjectState, ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { type ChatAttachment, mergedAttachments, type ToolOutcome } from "@/lib/agent/shared/attachments";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { forRequest, type Emitted, type Message } from "@/lib/agent/shared/conversation";
import { emptyReply, finishReasonOf, retryableEmpty } from "@/lib/agent/shared/model-finish";

/// tech-spec §III.6: the orchestrator routes, it never does the work itself.
/// Agents 2–5 arrive as tool calls here rather than as an ADK `sub_agents`
/// transfer — the Agent Engine deployment does not exist yet.
/// Written in sections rather than as one block, because a paragraph about a
/// tool the project cannot use is the same waste as the tool's own declaration —
/// paid on every round of every turn. `orchestratorInstruction` assembles the
/// ones this project has something for; see `orchestratorTools`, which gates the
/// declarations on exactly the same three counts so the instruction never
/// describes a call the model has not been given.
const ROLE = `You are the orchestrator of a moodboard assistant for creatives.

The user talks to you in plain language about the look they are chasing.
Help them articulate it: palette, lighting, texture, composition, subject,
contrast and depth are the vocabulary the rest of the pipeline works in, so
reflect their description back in those terms and ask about the ones they left
open.`;

const PICTURES = `The project's pictures are the user's own uploads. They are listed at the end
of these instructions, read fresh for this message: that list is the project, and
every id in it is one you may pass to a tool. Talk about the references from it
and never guess at a title, a count or a look that is not there. When you talk
about particular references, call show_references so the user sees them
beside your reply; a name in prose is not a picture.`;

/// Only when cuts exist. The list at the end of the instruction is the
/// photographs; `list_references` is for what priming cannot carry, so on a
/// project nobody has cropped it is a round spent to be told what the model
/// already has.
const CUTS = `The list is the photographs only — call list_references when the cuts made of
them matter as well, and they come back with the photographs.`;

const CROPPING = `When the user wants part of a frame — a tighter shot, the subject alone, this
one at scope — call crop_reference on that one reference. It cuts the picture and
files the cut: what comes back is a new reference in the project, shown beside
your reply, and the frame it came out of is untouched. So say what the cut keeps
and that it is theirs now, and offer the way back in the same sentence —
discard_reference removes a cut nobody wanted. Crop when a cut is asked for, on
the frame it is about.`;

/// Only when boards exist: a cut cannot be made for a slot on a board nobody has
/// composed yet.
const CROPPING_FOR_A_BOARD = `When the cut is meant to fill a slot on a board, pass that board as boardId:
the cut is then held to that slot's exact shape rather than to the format you
named, and it is put in that picture's place there in the same call — so say the
board has changed. Nothing else is owed: the exchange is made inside this call,
and it is the one edit to a thing standing on a page that you make yourself.`;

/// The routing that used to be `COMPOSING`, one agent along. Two calls rather
/// than one, because a board and what goes on it are now two decisions taken by
/// two different things: `add_board` is code and decides nothing, `design_page`
/// is agent 8 and decides everything.
const DESIGNING = `When the user wants something made — a moodboard, a poster, a spread, a sign,
an album page, a cover — it is two calls and they go in the same turn. First
add_board: it files a board with one empty page on it and that is all it does —
no model call, no picture chosen, nothing arranged. Pass a preset when they said
what shape the thing is, because a poster and a spread are not the same
rectangle. Then design_page on the board and page it just gave you, with what
they said as the intention in their own words: that is the call that puts
something on the page.

design_page is the only way a page is laid out, and it is the most expensive call
you have by a long way — so call it for the page they actually asked for and
never to illustrate a point, which is what show_references is for. What comes
back is a read of the page it left: which pictures are on it, which of the ones
you named are not, what it had to draw or cut to make it, and anything left
sitting beside the page rather than on it. Write your reply off that rather than
off its closing line alone and never off what you asked for — a design chooses
for itself, and the report is the only account of a page nobody else watched
being made. A picture it left off is a decision rather than a loss, so say the
page is without it rather than that something went wrong. And when a page comes
back other than as you pictured it, say what the read shows and stop there.
Explaining it with a mechanism you did not watch happen — a shape it inherited, a
format the board imposed — is a sentence that sounds like the product and is not:
what happened is in the result, and what could have happened instead is a
different call rather than a different board.`;

/// Only when boards exist. This is the longest section in the file and every
/// sentence of it is about an id the model has not been given until the project
/// has a board — which is why it is the one most worth gating.
///
/// It was longer. Two thirds of it were about `compose_moodboard`'s arguments —
/// templates, rebuilds, addReferenceIds, addCaptions, pageName — and every one
/// of those sentences pointed the model at a tool that no longer exists. What
/// is left is what these tools really are: free scene edits that move one thing
/// and leave the rest of the board exactly as it was.
const BOARDS = `The board they have open is named with the pictures at the end of these
instructions, and it is the board nearly every message is about. Every other
board they have is behind list_boards, which names them all for the cost of one
round — call it whenever they mean a board that is not the one in front of them,
and get_board_brief when you are holding an id and need to know what that board
is. No line says which pictures are on a board: call inspect_board for that,
which reads it and shows it beside your reply without changing anything. Do that
whenever they ask what is on a board, or point at one of its pictures by
position, and never design a page again to find out what it holds.

A board is one or more pages, each a fixed rectangle with a name of its own.
inspect_board lists them and reads one of them alone, and design_page designs one
of them — pass the pageId of the page they are talking about, or leave it out on
a board of one page. A board's line says how many pages it is on when it is on
more than one and what those pages are called, and a line that says nothing about
pages is a board of one page — so when they name a page and no board, the open
board is the board they mean when its line carries that page name, and
list_boards is how you find the board that does when it does not. On any board
whose line says it is a spread, read it with inspect_board to learn which page
they mean and get its pageId before you change any part of it, and never let a
page-scoped call fall back to its first page on a board you have not read.
Reading a page also says where each thing on it sits, so answer "the one on the
left", "the big one" and "what is under the headline" off that page read rather
than guessing or designing the page again to find out.

When they want *another* page — the exteriors on a page of their own, a second
page for the night work — call design_page with newPage and the intention for it:
the page is added beside what the board already has and everything standing on
the board stays standing. The page it adds is drawn at whatever rectangle the
design decides, so a format is never settled by the board it goes on: say so in
the intention or it is not said at all, and never tell the user a board's shape
fixes what can be added to it. When they want the page *empty* — somewhere to drag
pictures to, or a page at all on a board they arranged by hand and do not want
touched — call add_page instead: it draws the rectangle and nothing else, and on
a board with no pages it draws the first one around the pictures already there so
that board can be read and designed a page at a time from then on. Name a page
whenever the user called it something of their own: add_page takes the name it is
drawn with, and that name is what both of you say the page by afterwards.

A page is a frame and a frame clips what crosses its edge: a picture put past it
is drawn cut off there rather than squashed to fit. So a picture that is to stand
*behind* a page — a sketch they want as the background, a wash, a paper texture —
has to cover the page, bleed off both edges when it is not the page's shape, and
sit behind everything else standing there. That is three decisions about one
picture and it is design_page's: pass the picture as an imageId and say in the
intention that it is the background.

When they want a page a different *shape* — make that page portrait, turn it on
its side, make it square, put it back to 16:9 — call resize_page: it changes the
rectangle and nothing on the page moves. Say what the shape cost them: the answer
tells you which pictures a smaller page left beside it — still on the board, no
longer on that page — and which a larger one took in. Do not follow it with a
design to suit the new rectangle unless they ask; they asked for a different
shape of page and not for a different arrangement.

Everything so far is a board or a page: making one, reshaping one, copying one,
painting the board they stand on, offering to throw one away. **Anything that
changes a thing standing on a page is design_page's, whatever the size of the
change.** One picture in the place of another, two pictures trading places, a
picture moved onto a different page, a typo in a headline, a line added or taken
off — you have no call for any of them, and reaching for one is a round spent
finding that out. Pass what they said as the intention, name the page they mean,
and say afterwards what came back rather than what you asked for.

Say what that costs before it is spent when the ask is small. A design is the
dearest call you have and it takes minutes, so "fix the typo" is worth one
sentence saying the page is being opened for it — and then it is the call you
make, because a typo left on the board is worse than a minute.

When they want to try something *without losing* the board they have — another
version of it, a variant, "keep that one and try it with the tall shot" — call
duplicate_board first and make the change on the copy: it costs nothing, copies
the arrangement exactly and leaves the original alone, where every other call here
changes the board they are looking at. When what they want to try again is one
*page* of a spread — try that page with the tall shot, another version of the
exteriors — call duplicate_page instead and change the copy: it puts a copy of
that page beside the board's other pages, which stay where they are, where a
board copy would give them a second copy of every page they were not talking
about. Neither of those is design_page with newPage: that makes a page from
nothing, so what comes back is not a copy of the page they asked to keep. And a
new board every time is a tab row they have to tidy up after you.

When they want a board *gone* — bin it, delete it, they do not need that version
any more — call discard_board on the one they named. You cannot delete a board and
that call does not either: it puts the board in front of them with a Discard button
and they press it or they do not, so tell them what is on the board they would be
losing and that it cannot be undone, and never say it has gone until they say they
have done it. Offer the board they asked about and no others. When what they want
gone is one *page* of a board and not the board — lose the second page, bin the
page you just added, they do not need the exteriors any more — call discard_page
with that page's id instead: it offers the same way, and what they would lose is
that page and the photographs standing on it while the board and its other pages
stay. Do not offer the board when they asked about a page: discarding the board
takes the pages they asked to keep.`

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
/// user talking about the look before they have uploaded anything is a real
/// turn, and it should not carry the prose of five tools none of which can act.
const NOTHING_UPLOADED = `Nothing has been uploaded to this project yet, so there is nothing to show, cut
or compose. Help them describe the look they are after, and tell them the
references come from their own uploads — the gallery is where they add them. The
one picture that can arrive any other way is one you draw, and it lands in the
same gallery.`;

/// Ungated, like `generate_image` itself: every project can draw, including the
/// one with nothing in it. So this section is the only one here that is not a
/// function of what the project holds, and it names no other tool — the two
/// doors a new picture goes through next are named by the declaration, which is
/// gated on the same counts as everything else.
const GENERATING = `When the picture they need is not one anybody can upload — a paper or concrete
texture to stand behind a page, a dusk gradient, a flat colour field, a backdrop
no photograph is — call generate_image. It draws one and files it as a reference
like any other, with an id you can use from the next round of this same turn. Say
what shape it has to fill whenever it is being made to fill one. Then say in your
reply that the picture was made rather than found: a drawn backdrop is the one
thing in the gallery they cannot tell by looking.`;

/// Only where there is something to prefer. On the empty project the sentence
/// would be about pictures that do not exist.
const GENERATING_OVER_THEIRS = `Look at what they have first. A photograph of theirs that fits is one somebody
chose, and a drawn picture is the better answer only when nothing in the project
is what they asked for — or when what they asked for was a picture to be made.`;

/// And where every picture in the project came out of this same tool, which is
/// where a project that drew its way out of empty stands. "Prefer theirs" is
/// about a gallery that is not there; look-before-drawing is still right, and
/// the reason that survives is what a second call costs and what it comes back
/// with.
const GENERATING_OVER_DRAWN = `Look at what you have already drawn first. Every picture in this project came
out of this tool, so there is nothing of theirs to prefer — but the same
description drawn twice is the dearest call here made twice, and the second
picture is not the first one again. Reach for the one you have wherever it fits,
and draw when it genuinely does not.`;

const LIMITS = `You cannot fetch images, search for them, or change one you have been given.
Drawing a new one with generate_image is the exception and the only one: if they
ask you to go and find a picture, say plainly that the references are their own
uploads and what you can do instead is make one. Never invent image URLs and
never describe images you have not been given.

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
  const theirs = state ? pictures - (state.generated ?? 0) : 1;
  const crops = state ? state.crops : 1;
  const boards = state ? state.boards : 1;

  const instruction = [
    ROLE,
    ...(pictures > 0 ? [crops > 0 ? `${PICTURES}\n\n${CUTS}` : PICTURES] : [NOTHING_UPLOADED]),
    ...(pictures > 0 ? [boards > 0 ? `${CROPPING}\n\n${CROPPING_FOR_A_BOARD}` : CROPPING] : []),
    ...(pictures > 0 ? [REMOVING] : []),
    ...(pictures > 0 ? [DESIGNING] : []),
    ...(boards > 0 ? [BOARDS] : []),
    pictures > 0
      ? `${GENERATING}\n\n${theirs > 0 ? GENERATING_OVER_THEIRS : GENERATING_OVER_DRAWN}`
      : GENERATING,
    LIMITS,
  ].join("\n\n");

  return brief ? `${instruction}\n\nThe project, as it stands:\n${brief}` : instruction;
}

export type ToolCall = { name: string; args: Record<string, unknown> };
export type ToolExecutor = (call: ToolCall) => Promise<ToolOutcome>;

export type Turn = { role: "user" | "model"; text: string };

/// The model gets at most this many tool rounds before we make it answer — a
/// stuck model calling the same tool forever is a real failure mode.
///
/// It was three, and three was a number chosen when a round was the only thing
/// bounding the bill. It is not a ceiling on runaway any more — `TURN_TOKEN_CEILING`
/// below is — so what this number has to be is the length of the longest real
/// piece of work, and the work got longer than three: "use this sketch as the
/// background and lay my five pictures into its slots" is a layout read, a put,
/// a reorder and a crop for every slot that does not fit, and it died mid-crop
/// telling the user it had run out of steps. A hundred is far past any of that
/// deliberately: the round is no longer the thing worth counting.
export const MAX_TOOL_ROUNDS = 100;

/// What one turn may spend before the loop makes it answer, in tokens off the
/// responses themselves rather than off a count of calls.
///
/// This is the real bound on the *bill*, and it is a reading rather than a
/// guess — which is `model-cost.ts`'s whole argument: "Every ceiling in this codebase bounds
/// the *number* of calls, which is a guess at the bill rather than a reading of
/// it." A hundred rounds each re-sending the instruction, the declarations, the
/// brief and the turn's own work is a genuinely expensive accident, and it is
/// expensive in tokens whatever the round count happens to be.
///
/// The number: a turn's first call primes at ~3,800 tokens and a late one adds
/// the tool window on top of it, so a wide round is ~10,000. This is thirty of
/// those — several times the longest piece of work anyone has asked for, and a
/// small fraction of what a hundred unbounded rounds would come to.
///
/// What it does not bound is the turn's *length*: it counts this agent's own
/// calls, and a design's rounds are agent 8's. The wall a turn can actually hit
/// is `maxDuration` on the tRPC route, which is where that number lives.
export const TURN_TOKEN_CEILING = 300_000;

/// What the user is told when the loop stops a model that was still asking
/// for tools. It has written no text on that round — it was mid-call — so
/// without this the reply is the empty-parts fallback, and a bubble reading "…"
/// under three thumbnails is the assistant appearing to have nothing to say
/// about pictures it just went and fetched.
export const STUCK_REPLY =
  "I had a look but ran out of steps before I could answer properly — ask me again and I will pick up from what is above.";

/// Whether this turn has spent what it may. Read off the responses rather than
/// off the round count, so a turn of three enormous rounds and a turn of forty
/// small ones are bounded by the same number.
const overspent = (usage: TokenUsage) => usage.totalTokens >= TURN_TOKEN_CEILING;

export async function orchestrate({
  message,
  /// What the user attached to this message, already rendered to parts —
  /// a picture of a page and the page in words (§V.5). Prepended to their own
  /// sentence rather than sent as a turn of its own: it is context they chose
  /// *for* what they are about to say, and a message whose words arrive before
  /// the thing they are about is a question about nothing.
  attached = [],
  history = [],
  /// This project's photographs, primed into the instruction. Without it the
  /// model has to buy a round to find out what it is talking about, and a round
  /// is dearer than the list. A function for the reason `tools` is one: the
  /// catalog a round is answered against is the catalog as it stands on that
  /// round, and a picture drawn on the round before belongs in it.
  brief,
  /// What the project holds, so the instruction can leave out the sections about
  /// tools it has nothing to call them on. Same three counts `tools` is gated
  /// on, and read per round for the same reason they are: `generate_image` can
  /// take a project from holding nothing to holding a picture inside one turn,
  /// and an instruction settled before the loop would spend the rest of that
  /// turn saying there is nothing to show, cut or compose while handing the
  /// model the tools that do all three.
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
  generate = generateContentStream,
}: {
  message: string;
  attached?: GeneratePart[];
  history?: Turn[];
  brief?: string | (() => string | Promise<string>);
  state?: ProjectState | (() => ProjectState | Promise<ProjectState>);
  tools?: ToolDeclaration[] | (() => ToolDeclaration[] | Promise<ToolDeclaration[]>);
  execute?: ToolExecutor;
  generate?: typeof generateContentStream;
}) {
  /// The conversation as the one format holds it (`conversation.ts`): the
  /// history as settled messages, then the user's ask and the assistant's
  /// answer sharing this turn's id, with every round's emissions appended to
  /// the answer as they land. `forRequest` is the only assembler of what
  /// Vertex is sent — the projection a stored conversation goes through — so
  /// the live turn and the record cannot drift.
  const turnId = "this-turn";
  const asked: Emitted[] = [
    /// Stands where the rebuilt page block rides (`PART_RULES.page`). The
    /// caller hands the block already built and keeps the pointers to the
    /// pages it was built from, so this part is position, not description.
    ...(attached.length ? [{ type: "page", boardId: "", pageId: "", revision: 0, name: "" } as Emitted] : []),
    /// The attachment and the words are one user turn: the block and then the
    /// sentence, in that order. Re-sent on every round of the turn like the
    /// rest of the conversation — the model reading a tool result about a
    /// board is still looking at the page it was handed.
    { type: "text", text: message },
  ];
  const answering: Emitted[] = [];
  const messages: Message[] = [
    ...history.map(({ role, text }, back) => ({
      id: `history-${back}`,
      seq: back,
      turnId: `history-${back}`,
      role: role === "model" ? ("assistant" as const) : ("user" as const),
      parts: [{ type: "text" as const, text }],
      status: "sent" as const,
      at: "",
    })),
    { id: "asked", seq: history.length, turnId, role: "user", status: "sent", at: "", parts: asked },
    {
      id: "answering",
      seq: history.length + 1,
      turnId,
      role: "assistant",
      status: "pending",
      at: "",
      parts: answering,
    },
  ];
  const calls: ToolCall[] = [];
  /// What the tools put in front of the user this turn, gathered across
  /// every round: a model that lists the gallery, then shows three of it, has
  /// answered once and the chat draws one reply.
  let attachments: ChatAttachment[] = [];
  /// Every round re-sends the whole conversation, tool results and all, so a
  /// three-round turn is not three times a one-round turn — it is closer to six.
  /// This is the number `TURN_TOKEN_CEILING` is read against, which is what
  /// makes it a measured bound where a round count could only ever be a guess at
  /// one. Only the orchestrator's own calls: the agents it calls
  /// through tools write their own rows, and adding theirs here would bill the
  /// project twice for one crop.
  let usage = NO_USAGE;
  const declarations = typeof tools === "function" ? tools : () => tools;
  const priming = typeof brief === "function" ? brief : () => brief;
  const holdings = typeof state === "function" ? state : () => state;

  /// Tool rounds, counted where they are spent rather than per model call: a
  /// round is a *tool result added to the conversation*, and the retry below
  /// adds none, so it must not eat one of these.
  let rounds = 0;
  /// How many of those rounds the model could no longer see when it answered.
  /// `historyDropped`'s convention one level down: a turn the model answered
  /// without the first half of its own work is one whose reply is explicable,
  /// and the count is the only trace of that.
  let roundsDropped = 0;
  let retried = false;
  /// Model calls, which is a different number from rounds and the one the bill
  /// is made of: an answering call follows the last round, and a retry buys a
  /// call without buying a round. Every one of them re-sends the instruction,
  /// the declarations, the brief and the conversation so far — measured live at
  /// ~3,800 tokens of base for a turn's first call, so a turn's input is
  /// roughly `calls × base`.
  ///
  /// Some of that base is no longer paid for at the input rate. Probed on
  /// `FLASH` 2026-08-22: a three-call turn reported `cachedContentTokenCount`
  /// 10,919 of the 13,234 prompt tokens on its second call — implicit caching of
  /// the prefix every call re-sends, which `PRO` never reported and which the
  /// comment here used to deny. The rows this writes still price every prompt
  /// token at the full rate, because `TokenUsage` has nowhere to keep a cached
  /// count, so the orchestrator reads dearer than the invoice (§II, §VI).
  let modelCalls = 0;

  for (;;) {
    /// Resolved per round rather than once: a project that had no boards when
    /// the turn started has one the moment `add_board` files it — which is what
    /// makes `design_page` reachable on the round after, since its own gate is
    /// that same count. The
    /// instruction is resolved beside them and for the same reason — it is the
    /// prose half of the same answer, and the two disagreeing is worse than
    /// either being stale, since the sections it drops are the ones explaining
    /// the tools the round is handing over.
    const [round, primed, holds] = await Promise.all([declarations(), priming(), holdings()]);
    const systemInstruction = orchestratorInstruction(primed, holds);
    /// Windowed on the way out rather than pruned in place: `messages` is the
    /// turn's own record of what it did, and the rounds this drops are still the
    /// rounds it made. Recomputed per round because the newest pair landed a
    /// moment ago and the budget is spent on the whole tail, not on the tail as
    /// it stood last time.
    const sent = forRequest(messages, { turnId, attached });
    roundsDropped = sent.dropped;
    modelCalls += 1;
    const response = await generate(
      MODELS.FLASH,
      sent.contents,
      {
        systemInstruction,
        ...(round.length && { tools: [{ functionDeclarations: round }] }),
        thinkingConfig: { includeThoughts: true },
      },
      /// What the round is saying, as it says it. The split is `textOf`'s and
      /// `thoughtsOf`'s, one chunk at a time: a summary is the label and a plain
      /// text part is the reply typing itself.
      ///
      /// Both are surfaced, and neither is ever retracted: a tool round's
      /// narration is already a stored bubble (`forStorage` keeps every
      /// non-thought text part of every round), so text shown here is text the
      /// row was going to hold anyway. The round that ends the loop is the one
      /// whose text is also the reply.
      watchedBy(),
    );

    usage = addUsage(usage, usageOf(response));

    const finish = finishReasonOf(response);
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);
    const text = textOf(parts);

    /// The two ways a turn is stopped rather than finished. Read together
    /// because they end the same way — the model is made to answer with what it
    /// has — and apart from each other because only one of them is a number
    /// anybody guessed at.
    const spent = rounds >= MAX_TOOL_ROUNDS || overspent(usage);

    if (!execute || !requested.length || spent) {
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

      /// Only a ceiling earns the stuck sentence. A model calling a tool
      /// nobody gave it an executor for is a wiring fault, not a turn that ran
      /// out of steps, and telling the user to ask again would be a lie.
      const exhausted = spent && requested.length > 0;
      const reply = text || (exhausted ? STUCK_REPLY : requested.length ? "…" : emptyReply(finish));
      return {
        reply,
        /// The turn as the record will keep it (`forStorage`): the rounds as
        /// they landed on the answer, then the sentence the user was shown —
        /// the reply as decided above, fallbacks included, because the record
        /// is of what was said and not of what the model emitted.
        parts: [...answering, { type: "text", text: reply } as Emitted],
        calls,
        attachments,
        model: MODELS.FLASH,
        usage,
        /// What the tokens above were spent on. The comment on `usage` has
        /// claimed since iteration 1 that this is what makes `MAX_TOOL_ROUNDS`
        /// a measured ceiling, and until now neither number left the function —
        /// so a turn that cost three calls was indistinguishable on the ledger
        /// from one enormous call.
        rounds,
        /// How many of those rounds the window left behind, so a reply written
        /// without the first half of the turn's own work is readable afterwards
        /// as one.
        roundsDropped,
        modelCalls,
        /// Why it stopped, when that is not simply "it answered". Carried out so
        /// the turn's run row can hold it: a reply the user was given instead
        /// of an answer should be readable afterwards as what it was.
        finish,
      };
    }
    rounds += 1;
    const run = execute;

    /// Before the tools are awaited rather than after, which is the whole point
    /// of naming them: a round that takes ninety seconds should say what it is
    /// doing while it does it.
    ///
    /// The `callId`s are the ones the `call` parts below are built with — the
    /// same `${modelCalls}.${n}` over the same `functionCallsIn` order — so a
    /// step the column draws live and the step it draws off the stored row
    /// afterwards are one chip under one name.
    emit({
      kind: "calling",
      calls: requested.map((call, at) => ({
        callId: `${modelCalls}.${at + 1}`,
        name: call.name,
        args: call.args ?? {},
      })),
    });

    const outcomes = await Promise.all(
      requested.map(async (call) => {
        const args = call.args ?? {};
        calls.push({ name: call.name, args });
        return { name: call.name, outcome: await runSafely(run, { name: call.name, args }) };
      }),
    );

    emit({
      kind: "called",
      results: outcomes.map(({ name, outcome }, at) => ({
        callId: `${modelCalls}.${at + 1}`,
        name,
        /// `runSafely`'s reading, and the same one the `result` part below
        /// stores: a tool that threw came back as data, not as a failed turn.
        ok: !("error" in outcome.result),
      })),
    });

    for (const { outcome } of outcomes) {
      attachments = mergedAttachments(attachments, outcome.attachments ?? []);
    }

    /// The round onto the assistant's message, in the order it will serialize
    /// back out: the emission's parts — what the model said beside its calls
    /// stays a text part — then every answer. A call keeps the raw part it
    /// arrived as, because the emission carries fields the format does not
    /// model and the next round must return them untouched.
    let made = 0;
    answering.push(
      ...parts.map((part): Emitted => {
        /// A call naming no tool is kept, not obeyed: `functionCallsIn` already
        /// left it out of the round's work, and the format has no way to write
        /// a `call` part it cannot name. The raw part still rides along, so the
        /// next round returns the emission exactly as it arrived.
        const name = part.functionCall?.name;
        /// A thought summary arrives as a text part and is marked as one here,
        /// which is what keeps it out of the row and out of the chat column
        /// while `wire` still returns it on the next round.
        if (!name) {
          return { type: "text", text: part.text ?? "", wire: part, ...(part.thought && { thought: true }) };
        }
        made += 1;
        return {
          type: "call",
          callId: `${modelCalls}.${made}`,
          name,
          args: part.functionCall?.args ?? {},
          wire: part,
        };
      }),
      ...outcomes.map(({ name, outcome }, at): Emitted => ({
        type: "result",
        callId: `${modelCalls}.${at + 1}`,
        name,
        ok: !("error" in outcome.result),
        response: outcome.result,
      })),
    );
  }
}

/// A thrown tool goes back to the model as data, not as a 500 — "that project
/// has no references yet" is something the user needs told, and the model
/// is the thing holding the conversation.
async function runSafely(execute: ToolExecutor, call: ToolCall): Promise<ToolOutcome> {
  try {
    return await execute(call);
  } catch (cause) {
    return { result: { error: cause instanceof Error ? cause.message : String(cause) } };
  }
}

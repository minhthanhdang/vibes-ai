import { UNREAD_MARK, referenceDigest, type ToolReference } from "@/lib/agent/agent-tools";
import { CUSTOM_PAGE_PRESET, type PageSizeLabel } from "@/lib/pages/board-pages";
import { type PageBlock, type PageBox } from "@/lib/pages/page-blocks";

/// A page as the *model* reads it (tech-spec §V.4).
///
/// `page-blocks.ts` says where everything on a page sits. `page-contents.ts` says
/// which references are on it. Neither of them says what those references *are* —
/// and a page handed to a model as eight boxes with ids in them is an arrangement
/// of pictures it has to go and look up one at a time.
///
/// This is the two halves put together and said in one text block: the page's own
/// line — which board, which page of how many, what size, what template — and then
/// one line per block in the catalog's own format, so a picture on a page and a
/// row in the catalog describe a reference the same way and the model is not
/// learning a second dialect mid-prompt.
///
/// It is the text half of §V.4's `PageAIRepresentation`, whose other half is the
/// picture of the page rect. They are never sent apart: "a page the model was
/// handed but whose blocks were left out is a picture it has to guess about; the
/// properties without the picture are a list with no arrangement." So this text
/// says which of the two it is riding with — a page that went up without its
/// render is a page whose arrangement is only these numbers, and the model is
/// told that rather than left to assume there is an image above.
///
/// Two doors reach it (`PageBriefDoor`): the user attaching a page to a message
/// and a model calling `get_page` for one. They send the same text, because a
/// page described one way in the chat and another way through a tool is a second
/// dialect to learn halfway through a prompt.
///
/// Nothing reads it but the prompt: not stored, not a wire DTO, not what the chat
/// draws a page attachment from.
///
/// No canvas, no React, no DOM.

/// How many pages one message may carry (§V.5). Two, because the user picking
/// pages is comparing them — "this one against that one" — and because each is an
/// image part plus a text block on *every tool round of the turn*.
export const PAGES_PER_MESSAGE = 2;

/// The page's own line, off the row and the frame rather than off the blocks.
export type PageBriefPage = {
  /// What the tools take. The user attaching a page is usually about to ask
  /// for something to be done to it, and a model that has to call inspect_board
  /// to find out what the page it is looking at is called has bought a round to
  /// learn something the attachment already knew.
  boardId: string;
  pageId: string;
  boardTitle: string;
  /// The frame's name, empty on a page nobody has named.
  name: string;
  /// Reading order, 1-based, and how many pages the board has.
  position: number;
  of: number;
  /// The rectangle as it stands, not the preset it was made at.
  width: number;
  height: number;
  /// §V.1's derived label, `Custom` for a rectangle the user dragged off
  /// every preset. Carried because it is the one fact about a page's size that
  /// the two numbers above do not already say, and it decides what a compose
  /// does to the page: a Custom one keeps the rectangle they made and has the
  /// template fitted into it, a preset one is reshaped by the template it is
  /// laid out at.
  preset: PageSizeLabel;
  /// §V.4's "the template, if composed" — and *this page* composed at it, not
  /// the board. Absent for a page arranged by hand, one added after the compose,
  /// one laid out at another template, and one the user has pulled apart
  /// since: the board's row carries a single id describing its first page
  /// (§V.1), so on a spread it is as often as not the wrong word for the page
  /// being described. Silence is the honest answer — the boxes below are what
  /// the arrangement actually is, and a template name that does not describe
  /// them is a model reasoning about slots nobody is using.
  layout?: string | null;
};

/// Which door the page came through — the user picking it in the chat (§V.5.3)
/// or a model calling `get_page` for it (compositor-v2.md §IV.2).
///
/// One representation, two doors, no second dialect: everything below the first
/// line is the same text either way, and it has to be, or a page read through a
/// tool and a page attached to a message would be two things to learn. What
/// differs is who is looking and what a missing picture means. A model told the
/// user attached a page it fetched itself will thank them for it; a model told a
/// page "changed while it was being sent" when nobody sent anything is reading
/// an explanation of an event that did not happen.
export type PageBriefDoor = "attached" | "asked";

export type PageBrief = {
  page: PageBriefPage;
  /// Reading order, capped — `pageBlocks`' own answer, passed through.
  blocks: readonly PageBlock[];
  omitted: number;
  /// Whether a picture of the page rides with this text. False when the page
  /// moved between being picked and being sent: a stale picture is worse than no
  /// picture, and the model has to be told which it got.
  rendered: boolean;
  door?: PageBriefDoor;
  /// Why there is no picture, for the door the model opens. §IV.2: a page the
  /// renderer could not draw is an *error* there rather than the ordinary case,
  /// and it is said as one — `renderForModel` writes the sentence and it is
  /// carried through rather than restated, since it is the only thing that knows
  /// whether the clock ran out or the codec threw.
  renderFailure?: string;
  /// What the picture leaves out — `undrawnNote()`'s sentence, for a render that
  /// drew something as an empty outline. Said beside the line that says there is
  /// a picture, because it is a fact about that picture: an outline the text
  /// does not account for reads as an empty box the user drew.
  undrawnNote?: string;
  /// How the page is standing in its own rectangle — `occupancyNote()`'s
  /// sentence. Absent at the door nobody measured it at: the chat's page render
  /// is drawn in the browser and there is no plan on this side of it, while a
  /// model asking for a page is handed one by the same renderer that drew the
  /// picture.
  ///
  /// Beside the picture line rather than below the blocks, because it is the one
  /// fact about the arrangement that the blocks cannot be read off: they say
  /// where each thing sits and this says what the whole frame came to (§VIII).
  standingNote?: string;
  /// Whether the type on it can be read where it stands — `contrastNote()`'s
  /// sentence, absent on the page that clears and at the door that measured
  /// nothing. Beside the standing note because they are one reading of the same
  /// plan taken twice (§VIII): that one says where the work is and this one says
  /// whether it can be read there, and neither can be got off the block lines,
  /// which carry boxes and words and no colour at all.
  legibilityNote?: string;
};

/// The page, as one text part.
///
/// Bounded by `PAGE_BLOCK_CAP` alone — how many things are described — and not
/// by how long the description of them runs. `PAGE_BRIEF_CHAR_BUDGET` was the
/// second bound and is gone (§V.4): 3,000 characters, `HISTORY_CHAR_BUDGET /
/// PAGES_PER_MESSAGE`, so that two attached pages cost at most what the
/// conversation behind them does. The two were doing one job at two levels of
/// honesty. The block cap bounds by *things on the page*, which is a fact about
/// the page and reads as one — two dozen blocks and a line saying how many were
/// left out. A character budget bounds by how much was written about them,
/// which cuts through a set of blocks that are each worth describing and hands
/// back a page the model believes it has been shown all of and has been shown
/// most of. A user attaches a page because they want it read, and a half-read
/// page is the failure the attachment exists to prevent.
///
/// The price is that this is the one input to a turn with no size ceiling of its
/// own: it rides in the user's message, so no window trims it, and it is re-sent
/// on every tool round of the turn. What is left holding it is the block cap,
/// `PAGES_PER_MESSAGE` and the turn's `TURN_TOKEN_CEILING` — and if two dozen
/// richly-tagged blocks ever price badly, the answer is an argument for a
/// narrower `PAGE_BLOCK_CAP` rather than the character budget coming back.
export function pageBriefText(brief: PageBrief, references: readonly ToolReference[]): string {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const { blocks, omitted } = brief;

  const stacked = stackedBlocks(blocks);
  const lines = blocks.map((block, at) => blockLine(block, byId, stacked.has(at) ? block.z : null));

  return [
    headLine(brief, lines.length, stacked.size > 0),
    ...lines,
    /// What the cap left out, counted: something is on this page that the model
    /// has not been told about.
    omittedLine(omitted),
  ]
    .filter(Boolean)
    .join("\n");
}

/// Which blocks lie on another block. §V.4 carries `z` "because a collage's
/// overlap is the thing array order was carrying" — and on a page where nothing
/// overlaps it is a number the model can do nothing with, since the boxes
/// already say everything about where the blocks sit. So it is said for the
/// blocks it disambiguates and nowhere else, which on the templates the
/// compositor draws means POLAROID_SCATTER and otherwise the pages the user
/// dragged together by hand.
///
/// Boxes are thousandths and rounded, so two blocks laid edge to edge can come
/// out sharing a thousandth. An overlap has to be wider than that rounding in
/// both directions to be a stack rather than a seam.
function stackedBlocks(blocks: readonly PageBlock[]): ReadonlySet<number> {
  const stacked = new Set<number>();

  blocks.forEach((block, at) => {
    for (let other = at + 1; other < blocks.length; other += 1) {
      if (!liesOn(block.box, blocks[other]!.box)) continue;
      stacked.add(at);
      stacked.add(other);
    }
  });

  return stacked;
}

const SEAM = 1;

function liesOn(one: PageBox, other: PageBox): boolean {
  const [top, left, bottom, right] = one;
  const [otherTop, otherLeft, otherBottom, otherRight] = other;

  return (
    Math.min(right, otherRight) - Math.max(left, otherLeft) > SEAM &&
    Math.min(bottom, otherBottom) - Math.max(top, otherTop) > SEAM
  );
}

function headLine(brief: PageBrief, described: number, stacked: boolean) {
  const { page, door = "attached" } = brief;
  return [
    openingLine(page, door),
    idsLine(page),
    customSizeLine(page),
    pictureLine(brief, door),
    brief.standingNote ?? "",
    brief.legibilityNote ?? "",
    stacked ? STACKED : "",
    countLine(described),
  ]
    .filter(Boolean)
    .join(" ");
}

/// Which of the two the model got, said either way. §V.5.3's rule — "whether a
/// picture rides above the text is said in the text, never left to be assumed" —
/// is the whole reason this line exists, and it holds at both doors.
function pictureLine({ rendered, renderFailure, undrawnNote }: PageBrief, door: PageBriefDoor) {
  if (rendered) {
    return [door === "asked" ? DRAWN : RENDERED, undrawnNote].filter(Boolean).join(" ");
  }
  if (door === "attached") return NOT_RENDERED;
  return renderFailure ? `There is no picture of it — ${renderFailure}.` : NOT_DRAWN;
}

/// What `z` on a line means, said once rather than per line. The same words
/// `inspect_board`'s arrangement note uses for the same field, so a model that
/// has read one page through a tool and one through an attachment is not being
/// told the ordering twice in two dialects.
const STACKED =
  "Some blocks on it overlap: those lines carry z, the stacking order with 0 at the back, so of two overlapping blocks the higher z is the one on top.";

const RENDERED = "The image above is that page.";

/// The same fact for the other door, without the word *above*: a tool's picture
/// rides after the answer it belongs to rather than before it, and a model told
/// to look up when the picture is below is a model describing the wrong part of
/// its own context.
///
/// Taken by what it is a picture *of*, because `read_canvas` carries one too
/// (compositor-v2.md §IV.1) and a second wording for the same fact is a second
/// thing to learn about where a tool's picture sits.
export const drawnLine = (of: "page" | "board") =>
  `The picture that came back with this answer is that ${of} as it stands now.`;

const DRAWN = drawnLine("page");

/// The renderer failed and said nothing about why — an answer this should never
/// have to give, and given all the same rather than going quiet, because a model
/// reading a page it was told it cannot see is strictly better than one assuming
/// it saw the page.
const NOT_DRAWN =
  "There is no picture of it — the renderer failed, so the boxes below are the whole of what you have of this page. Answer from them and say you could not see it.";

/// §V.5: the tab re-renders once when the revision has moved under it, and if it
/// still disagrees the page goes up as text only — "said in the text", because a
/// model told nothing would answer about a picture it was never shown.
const NOT_RENDERED =
  "There is no picture of it — the page changed while it was being sent, so the boxes below are the whole of what you have been given of it.";

function openingLine(
  { boardTitle, name, position, of, width, height, layout }: PageBriefPage,
  door: PageBriefDoor,
) {
  const board = boardTitle.trim() || "Untitled board";
  const which = `page ${position} of ${of} of the board “${board}”`;
  const lead = door === "asked" ? "This is" : "The user attached";
  return [
    /// The user's own word for the page first, when they have given it one:
    /// it is what they will say back, and "page 2" is what the board calls it
    /// rather than what they do.
    name ? `${lead} “${name}” — ${which}` : `${lead} ${which}`,
    `${width}×${height}`,
    ...(layout ? [`composed at ${layout}`] : []),
  ].join(", ") + ".";
}

/// The two ids every board tool takes, said once. Without them "put the
/// stairwell on this page" is a round of inspect_board spent finding out which
/// page "this" is — and the answer to that is already in the sentence above.
function idsLine({ boardId, pageId }: PageBriefPage) {
  return `The tools reach it as boardId ${boardId}, pageId ${pageId}.`;
}

/// Said only for a page whose rectangle is nobody's preset, on iteration 7's
/// rule that a fact is worth a line only where it disambiguates: a page at a
/// preset has already said its size in numbers and the label adds nothing the
/// model can act on, while `Custom` is a rule about what a compose will do to
/// it. Without this, the one page in the app that keeps its own rectangle is
/// the one the model would tell the user it is about to resize.
function customSizeLine({ preset }: PageBriefPage) {
  if (preset !== CUSTOM_PAGE_PRESET) return "";
  return "That size is the user's own rather than a page preset, so laying it out again fits the template into their rectangle instead of resizing the page.";
}

function countLine(blocks: number) {
  if (blocks === 0) return "There is nothing on it.";
  return blocks === 1 ? "1 block on it:" : `${blocks} blocks on it, in reading order:`;
}

/// What the cap dropped, counted. A cap that does not say what it dropped reads
/// as coverage — the same rule the catalog's truncated list follows.
///
/// And *which* it dropped, since the cap spends by reach (`byReach`): they are
/// the smallest things on the page and never a region of it. Said because the
/// alternative is a model reading "17 more blocks" as seventeen unknowns
/// anywhere on the rectangle, when the lines above already account for every
/// part of it that carries anything large.
function omittedLine(omitted: number) {
  if (omitted <= 0) return "";
  return omitted === 1
    ? "1 more block is on this page and is not described — the smallest thing on it."
    : `${omitted} more blocks are on this page and are not described — the smallest things on it.`;
}

/// `[ymin,xmin,ymax,xmax]`, y-first and in thousandths of the page. Written
/// without spaces so a line of six fields stays one line.
function boxSaid(box: PageBox) {
  return `[${box.join(",")}]`;
}

const CLIPPED_MARK = "clipped at the page edge";

/// Null on a block sitting clear of every other one, where the stacking order is
/// a fact about nothing.
function stackSaid(z: number | null) {
  return z === null ? "" : `z ${z}`;
}

function blockLine(block: PageBlock, byId: ReadonlyMap<string, ToolReference>, z: number | null) {
  const box = boxSaid(block.box);
  const stack = stackSaid(z);
  const over = block.clipped ? CLIPPED_MARK : "";
  /// Said on whichever kind carries it, because a fade is arrangement rather
  /// than appearance: what is behind a block at 30% is still on the page, and a
  /// reader told a photograph sits there reads a scrim as the picture.
  const faded = block.opacity !== undefined ? `${block.opacity}% opaque` : "";

  if (block.kind === "text") {
    return ["text", `“${block.text}”`, faded, box, stack, over]
      .filter(Boolean)
      .join(" · ");
  }

  /// A shape says the two facts a reader acts on: what it is and what colour it
  /// is standing there in (§XI.5). Which colour that is depends on the shape: a
  /// rule is drawn in its stroke and has no fill to speak of, and a rectangle
  /// with nothing behind it is a border rather than a block — a model that
  /// cannot tell a frame around the type from a field under it puts the
  /// headline in the wrong place. The rest of the appearance (stroke width,
  /// dashes, rounded corners) is what `read_canvas` is for: it is what a
  /// restyle takes, not what an arrangement is made of. A text block's own
  /// colour, family and size fall on that same side of the line — this brief
  /// rides under a picture that shows all three, and the pairs a reader has to
  /// act on arrive named in the legibility note instead (§VIII).
  if (block.kind === "shape") {
    return [
      block.shape,
      block.shape === "line"
        ? block.stroke
        : block.fill === "transparent"
          ? `outline in ${block.stroke}, nothing behind it`
          : block.fill,
      faded,
      box,
      stack,
      over,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const reference = block.referenceId ? byId.get(block.referenceId) : undefined;
  /// On the page and not in the project: an image element naming nothing, or a
  /// reference deleted out from under the board. Kept as a block rather than
  /// dropped — it is taking up that room on the page, and an arrangement with a
  /// hole in it reads as empty page — but described as what it is, since the
  /// server never resolves an id it cannot see in the project.
  if (!reference) {
    return [block.referenceId, "not one of this project's pictures", faded, box, stack, over]
      .filter(Boolean)
      .join(" · ");
  }

  const { id, title, shape, croppedFrom, keeps, tags, unread } = referenceDigest(reference);
  return [
    id,
    title,
    shape,
    /// Why this picture is the shape it is. A cut's line names the frame it came
    /// out of, so "the tight one" and "the wide one it was taken from" are two
    /// blocks the model can tell apart when both are on the page.
    croppedFrom ? [`cut of ${croppedFrom}`, keeps && `keeps “${keeps}”`].filter(Boolean).join(", ") : keeps,
    faded,
    box,
    stack,
    over,
    tags?.join(", "),
    unread && UNREAD_MARK[unread],
  ]
    .filter(Boolean)
    .join(" · ");
}

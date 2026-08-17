import { UNREAD_MARK, referenceDigest, type ToolReference } from "@/lib/agent/agent-tools";
import { HISTORY_CHAR_BUDGET } from "@/lib/agent/chat-history";
import { CUSTOM_PAGE_PRESET, type PageSizeLabel } from "@/lib/pages/board-pages";
import type { PageBlock, PageBox } from "@/lib/pages/page-blocks";

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
/// Nothing reads it but the prompt: not stored, not a wire DTO, not what the chat
/// draws a page attachment from.
///
/// No canvas, no React, no DOM.

/// How many pages one message may carry (§V.5). Two, because the director picking
/// pages is comparing them — "this one against that one" — and because each is an
/// image part plus a text block on *every tool round of the turn*.
export const PAGES_PER_MESSAGE = 2;

/// §V.4's third cap, in characters, per page. The block cap bounds how many
/// things are described; it does not bound how long a description is, and the
/// two are not the same page: two dozen references with six dimensions of tags
/// and a cut line each is several times the text of two dozen bare boxes.
///
/// Derived from the history window rather than picked, so the pages a message
/// carries cost at most what the whole conversation behind it does — and the
/// same argument applies to both: this rides on *every tool round of the turn*,
/// so a page described at length is that length times the rounds. Characters
/// rather than tokens for chat-history's own reason — an approximation that
/// never under-counts beats a precise number that costs a call.
export const PAGE_BRIEF_CHAR_BUDGET = Math.floor(HISTORY_CHAR_BUDGET / PAGES_PER_MESSAGE);

/// The page's own line, off the row and the frame rather than off the blocks.
export type PageBriefPage = {
  /// What the tools take. The director attaching a page is usually about to ask
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
  /// §V.1's derived label, `Custom` for a rectangle the director dragged off
  /// every preset. Carried because it is the one fact about a page's size that
  /// the two numbers above do not already say, and it decides what a compose
  /// does to the page: a Custom one keeps the rectangle they made and has the
  /// template fitted into it, a preset one is reshaped by the template it is
  /// laid out at.
  preset: PageSizeLabel;
  /// §V.4's "the template, if composed" — and *this page* composed at it, not
  /// the board. Absent for a page arranged by hand, one added after the compose,
  /// one laid out at another template, and one the director has pulled apart
  /// since: the board's row carries a single id describing its first page
  /// (§V.1), so on a spread it is as often as not the wrong word for the page
  /// being described. Silence is the honest answer — the boxes below are what
  /// the arrangement actually is, and a template name that does not describe
  /// them is a model reasoning about slots nobody is using.
  layout?: string | null;
};

export type PageBrief = {
  page: PageBriefPage;
  /// Reading order, capped — `pageBlocks`' own answer, passed through.
  blocks: readonly PageBlock[];
  omitted: number;
  /// Whether a picture of the page rides above this text. False when the page
  /// moved between being picked and being sent: a stale picture is worse than no
  /// picture, and the model has to be told which it got.
  rendered: boolean;
};

/// The page, as one text part.
export function pageBriefText(
  brief: PageBrief,
  references: readonly ToolReference[],
  { budget = PAGE_BRIEF_CHAR_BUDGET }: { budget?: number } = {},
): string {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const { blocks, omitted, rendered, page } = brief;

  const stacked = stackedBlocks(blocks);
  const lines = blocks.map((block, at) => blockLine(block, byId, stacked.has(at) ? block.z : null));
  /// The page's own line and the tail are what the model needs to read *any* of
  /// this — which page it is looking at, and that it is not looking at all of
  /// it. So the budget is spent on the blocks, with room held back for both,
  /// measured at their longest: the head shrinks as blocks are dropped and the
  /// tail is longest when everything is.
  const held =
    headLine(page, rendered, blocks.length, stacked.size > 0).length +
    omittedLine(omitted + lines.length).length;
  const kept = withinBudget(lines, budget - held);

  return [
    headLine(page, rendered, kept.length, stacked.size > 0),
    ...kept,
    /// One count for both caps: a block past the cap and a block past the budget
    /// are the same fact to a reader — something is on this page that they have
    /// not been told about.
    omittedLine(omitted + (lines.length - kept.length)),
  ]
    .filter(Boolean)
    .join("\n");
}

/// As many lines as fit, in reading order. The first one always does: a page
/// answered with no blocks at all is a page the model cannot say anything about,
/// and one line is bounded — every field on it is clamped or a number.
function withinBudget(lines: readonly string[], room: number): string[] {
  const kept: string[] = [];
  let spent = 0;
  for (const line of lines) {
    spent += line.length + 1;
    if (kept.length && spent > room) break;
    kept.push(line);
  }
  return kept;
}

/// Which blocks lie on another block. §V.4 carries `z` "because a collage's
/// overlap is the thing array order was carrying" — and on a page where nothing
/// overlaps it is a number the model can do nothing with, since the boxes
/// already say everything about where the blocks sit. So it is said for the
/// blocks it disambiguates and nowhere else, which on the templates the
/// compositor draws means POLAROID_SCATTER and otherwise the pages the director
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

function headLine(page: PageBriefPage, rendered: boolean, described: number, stacked: boolean) {
  return [
    openingLine(page),
    idsLine(page),
    customSizeLine(page),
    rendered ? RENDERED : NOT_RENDERED,
    stacked ? STACKED : "",
    countLine(described),
  ]
    .filter(Boolean)
    .join(" ");
}

/// What `z` on a line means, said once rather than per line. The same words
/// `inspect_board`'s arrangement note uses for the same field, so a model that
/// has read one page through a tool and one through an attachment is not being
/// told the ordering twice in two dialects.
const STACKED =
  "Some blocks on it overlap: those lines carry z, the stacking order with 0 at the back, so of two overlapping blocks the higher z is the one on top.";

const RENDERED = "The image above is that page.";

/// §V.5: the tab re-renders once when the revision has moved under it, and if it
/// still disagrees the page goes up as text only — "said in the text", because a
/// model told nothing would answer about a picture it was never shown.
const NOT_RENDERED =
  "There is no picture of it — the page changed while it was being sent, so the boxes below are the whole of what you have been given of it.";

function openingLine({ boardTitle, name, position, of, width, height, layout }: PageBriefPage) {
  const board = boardTitle.trim() || "Untitled board";
  const which = `page ${position} of ${of} of the board “${board}”`;
  return [
    /// The director's own word for the page first, when they have given it one:
    /// it is what they will say back, and "page 2" is what the board calls it
    /// rather than what they do.
    name ? `The director attached “${name}” — ${which}` : `The director attached ${which}`,
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
/// the one the model would tell the director it is about to resize.
function customSizeLine({ preset }: PageBriefPage) {
  if (preset !== CUSTOM_PAGE_PRESET) return "";
  return "That size is the director's own rather than a page preset, so laying it out again fits the template into their rectangle instead of resizing the page.";
}

function countLine(blocks: number) {
  if (blocks === 0) return "There is nothing on it.";
  return blocks === 1 ? "1 block on it:" : `${blocks} blocks on it, in reading order:`;
}

/// What the cap dropped, counted. A cap that does not say what it dropped reads
/// as coverage — the same rule the catalog's truncated list follows.
function omittedLine(omitted: number) {
  if (omitted <= 0) return "";
  return omitted === 1
    ? "1 more block is on this page and is not described."
    : `${omitted} more blocks are on this page and are not described.`;
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

  if (block.kind === "text") {
    return ["text", `“${block.text}”`, box, stack, over].filter(Boolean).join(" · ");
  }

  const reference = block.referenceId ? byId.get(block.referenceId) : undefined;
  /// On the page and not in the project: an image element naming nothing, or a
  /// reference deleted out from under the board. Kept as a block rather than
  /// dropped — it is taking up that room on the page, and an arrangement with a
  /// hole in it reads as empty page — but described as what it is, since the
  /// server never resolves an id it cannot see in the project.
  if (!reference) {
    return [block.referenceId, "not one of this project's pictures", box, stack, over]
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
    box,
    stack,
    over,
    tags?.join(", "),
    unread && UNREAD_MARK[unread],
  ]
    .filter(Boolean)
    .join(" · ");
}

import { UNREAD_MARK, referenceDigest, type ToolReference } from "@/lib/agent/agent-tools";
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
  /// The template the board was composed at, absent for one arranged by hand.
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
export function pageBriefText(brief: PageBrief, references: readonly ToolReference[]): string {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const { blocks, omitted, rendered, page } = brief;

  return [
    [openingLine(page), idsLine(page), rendered ? RENDERED : NOT_RENDERED, countLine(blocks.length)]
      .filter(Boolean)
      .join(" "),
    ...blocks.map((block) => blockLine(block, byId)),
    omittedLine(omitted),
  ]
    .filter(Boolean)
    .join("\n");
}

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

function blockLine(block: PageBlock, byId: ReadonlyMap<string, ToolReference>) {
  const box = boxSaid(block.box);
  const over = block.clipped ? CLIPPED_MARK : "";

  if (block.kind === "text") {
    return ["text", `“${block.text}”`, box, over].filter(Boolean).join(" · ");
  }

  const reference = block.referenceId ? byId.get(block.referenceId) : undefined;
  /// On the page and not in the project: an image element naming nothing, or a
  /// reference deleted out from under the board. Kept as a block rather than
  /// dropped — it is taking up that room on the page, and an arrangement with a
  /// hole in it reads as empty page — but described as what it is, since the
  /// server never resolves an id it cannot see in the project.
  if (!reference) {
    return [block.referenceId, "not one of this project's pictures", box, over]
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
    over,
    tags?.join(", "),
    unread && UNREAD_MARK[unread],
  ]
    .filter(Boolean)
    .join(" · ");
}

import { ReferenceOrigin } from "@/generated/prisma/enums";
import { clipped, collapsed } from "@/lib/util/text";
import { referenceCaption } from "@/lib/references/reference-version";
import { layoutLabel, type LayoutName } from "@/lib/layout/moodboard-layouts";
import type { BoardPreview } from "@/lib/boards/board-preview";
import type { UsingBoard } from "@/lib/references/reference-usage";
import type { ToolReference } from "@/lib/agent/shared/reference";

/// What a tool answers with, and what of that answer the user sees.
///
/// Kept pure and out of `server/` because both sides need it: the executor
/// builds these values, the chat renders them.

/// A picture rendered in the chat beside the reply, and clickable: what it
/// takes to draw it *and* what it takes to walk to it.
export type ReferenceAttachment = {
  kind: "reference";
  referenceId: string;
  /// The frame this is a cut of, or null when it is a photograph in its own
  /// right. This is the row the properties panel opens on.
  frameId: string | null;
  title: string;
  caption: string;
  thumbUrl: string;
  /// Set only by `discard_reference`: this tile carries a decision rather than a
  /// result, and the Remove button under it is what settles it. Present or
  /// absent, never false — a picture tile is a picture tile.
  ///
  /// A payload rather than a flag, because the browser has to say what the
  /// removal *cost* after it has happened, and by then there is no row to ask:
  /// the cuts have cascaded and the boards are already showing placeholders.
  /// Same reason a board tile carries `images`.
  discard?: { cuts: number; boards: UsingBoard[] };
  /// Where the bytes came from, carried for the sentence the *browser* writes
  /// after the Remove button is pressed: by then the row is deleted and the tile
  /// is the only thing left that knows what the picture was. Absent when the
  /// door that built the tile never read the column, which words the removal the
  /// way it always was.
  origin?: ReferenceOrigin | null;
};

/// Which page a board tile's Discard button would take, when it takes a page
/// rather than the board. Set only by `discard_page`; a payload rather than a
/// second flag.
export type PageDiscardOffer = { pageId: string; name: string };

/// A board the assistant composed, in the chat. Same two halves as a
/// reference's.
export type BoardAttachment = {
  kind: "board";
  boardId: string;
  title: string;
  caption: string;
  /// A board's own picture is drawn by the tab showing it, so a board that has
  /// never been opened does not have one. Until then the cover is the photograph
  /// the compositor put in the opening slot — which is the picture the board is
  /// about, and the one thing about it that is true before it is drawn.
  thumbUrl: string | null;
  /// The arrangement, as the chat can draw it: every placed picture's box in
  /// percent of the page. A board is what the pictures were put *into*, so one
  /// photograph off it is the one thing that is not a picture of the board.
  /// Null only when there is nothing placed to draw; the cover is the fallback.
  preview: BoardPreview | null;
  /// What the board says, in reading order — the words themselves rather than a
  /// count of them.
  ///
  /// The miniature cannot carry them: a headline block is about 5% of a page's
  /// height, which is five pixels in a tile this size, so the one thing a
  /// user asked to *change* would be drawn as a grey bar. They are carried
  /// as strings and set beside the arrangement instead.
  ///
  /// Capped, because a hand-arranged board may hold a paragraph and this is a
  /// tile: `linesOver` counts what did not fit rather than letting the tile end
  /// on a line that reads as the last one.
  lines: string[];
  linesOver: number;
  /// How many photographs are on it. Already in the caption in words; carried as
  /// a number because the browser has to say what a board *was* after it has
  /// deleted it, and by then there is no row to count.
  images: number;
  /// Set only by `discard_board`: this tile carries a decision rather than a
  /// result. Present or absent, never false — a board tile is a board tile, and
  /// the flag is what puts the Discard button under it.
  ///
  /// A flag on the board tile rather than a fourth attachment kind, because a
  /// board offered for discarding *is* the board: same id, same key, same
  /// arrangement, same click into the tab row. The only difference is that the
  /// user can end it from here, and one board still has one tile in the
  /// strip however many ways this turn talked about it.
  discard?: true;
  /// Set only by `discard_page`: the button under this tile takes the page the
  /// tile is drawn from rather than the board it is on. Present or absent, and
  /// only ever beside `discard` — a tile with no button has nothing to say about
  /// which page a button would take.
  discardPage?: PageDiscardOffer;
};

export type ChatAttachment = ReferenceAttachment | BoardAttachment;

/// What makes two attachments the same attachment.
export function attachmentKey(attachment: ChatAttachment) {
  if (attachment.kind === "board") return `board:${attachment.boardId}`;
  return `reference:${attachment.referenceId}`;
}

export function attachmentOf(
  reference: ToolReference,
  discard?: { cuts: number; boards: UsingBoard[] },
): ReferenceAttachment {
  return {
    kind: "reference",
    referenceId: reference.id,
    frameId: reference.source?.id ?? null,
    title: reference.title.trim() || "Untitled",
    caption: referenceCaption(reference),
    thumbUrl: reference.thumbUrl,
    ...(discard && { discard }),
    ...(reference.origin && { origin: reference.origin }),
  };
}

/// How many of a board's lines a tile shows, and how much of one.
export const BOARD_LINES_SHOWN = 3;
export const BOARD_LINE_CHARS = 60;

function boardLines(lines: readonly string[]) {
  const said = lines.map(collapsed).filter(Boolean);
  return {
    lines: said.slice(0, BOARD_LINES_SHOWN).map((line) => clipped(line, BOARD_LINE_CHARS)),
    linesOver: Math.max(0, said.length - BOARD_LINES_SHOWN),
  };
}

/// The page a tile is of, said as the user knows it — and said only when it
/// tells them something.
function pageCaption({ name, position, of }: { name: string; position: number; of: number }) {
  if (of <= 1) return "";
  const which = `page ${position} of ${of}`;
  return name.trim() ? `“${name.trim()}”, ${which}` : which;
}

/// A composed board, as the chat draws it. The caption is what the board *is*
/// rather than what it is called.
export function boardAttachmentOf({
  id,
  title,
  layout,
  page,
  onPage,
  images,
  lines = [],
  thumbUrl,
  preview = null,
  discard = false,
  discardPage,
}: {
  id: string;
  title: string;
  /// The template the board is standing in — passed by the compose that just
  /// laid it out, and by a read of a board still sitting in its slots
  /// (`standsAsComposed`). A board the user has rearranged is no longer the
  /// shape of the template it started as, so it passes none and the page says
  /// what it is instead.
  layout?: LayoutName;
  page?: { width: number; height: number };
  /// Which page of the board this tile is of, when it is of one rather than of
  /// the whole canvas. The user looking at a reply about page 2 of a spread has
  /// to be shown page 2: a tile drawn from the whole board says the reply is
  /// about all of it, and on a board of four pages the picture the sentence is
  /// about is a quarter of the miniature.
  onPage?: { name: string; position: number; of: number };
  images: number;
  /// The words on the board, in reading order. A board carrying a headline and
  /// one that carries none are otherwise the same tile, which is wrong in the
  /// one reply that is *about* the headline.
  lines?: readonly string[];
  thumbUrl: string | null;
  preview?: BoardPreview | null;
  /// Whether this tile is an offer to throw the board away. Only
  /// `discard_board` passes it, and nothing else on the tile changes.
  discard?: boolean;
  /// The page the offer takes, when the offer is `discard_page`'s. Passed with
  /// `discard`, never instead of it: it says what the button does rather than
  /// whether there is one.
  discardPage?: PageDiscardOffer;
}): BoardAttachment {
  const shape = layout ? layoutLabel(layout) : page ? `${page.width}×${page.height}` : "";
  const said = boardLines(lines);
  const total = said.lines.length + said.linesOver;
  return {
    kind: "board",
    boardId: id,
    title: title.trim() || "Untitled board",
    caption: [
      /// First, because it says what the tile is *of*. The board's own name is
      /// already above it, so what is missing on a spread is which of its pages
      /// the miniature below is.
      onPage ? pageCaption(onPage) : "",
      `${images} ${images === 1 ? "photograph" : "photographs"}`,
      total ? `${total} ${total === 1 ? "line" : "lines"}` : "",
      shape,
    ]
      .filter(Boolean)
      .join(" · "),
    thumbUrl,
    preview,
    images,
    ...said,
    ...(discard && { discard: true as const }),
    ...(discard && discardPage && { discardPage }),
  };
}

/// What a tool answers with: the JSON the model reads back, and the pictures
/// the user sees, kept separate because they are for different readers.
export type ToolOutcome = {
  result: Record<string, unknown>;
  attachments?: ChatAttachment[];
};

/// Where a click on an attachment lands — which half of the page is showing and
/// which id the panel opens, and nothing else.
export type AttachmentTarget =
  | {
      view: "gallery";
      /// The reference whose properties open. A cut opens the frame it came
      /// from: a cut's properties are a step *inside* that panel — the versions
      /// list under the frame — and the panel has no way in at a cut from
      /// outside.
      inspectId: string;
      /// The cut the click was actually on, when what was shown is a version
      /// rather than a photograph. A crop opens the original's properties *at*
      /// that version — the frame alone is the right panel and the wrong
      /// answer, since a frame with nine cuts under it leaves the user hunting
      /// the row the assistant just showed them.
      versionId?: string;
    }
  /// A board opens as a board: the composed scene is the thing to look at, and
  /// the tab row is where it is then renamed, duplicated or thrown away.
  | { view: "design"; boardId: string };

export function attachmentTarget(attachment: ChatAttachment): AttachmentTarget {
  if (attachment.kind === "board") return { view: "design", boardId: attachment.boardId };
  if (attachment.frameId) {
    return {
      view: "gallery",
      inspectId: attachment.frameId,
      versionId: attachment.referenceId,
    };
  }
  return { view: "gallery", inspectId: attachment.referenceId };
}

/// One conversation's attachments, in arrival order, each picture once. A
/// *board* is the exception: a later view of one replaces the earlier and keeps
/// its place in the strip.
export function mergedAttachments(
  current: readonly ChatAttachment[],
  added: readonly ChatAttachment[],
) {
  const merged = [...current];
  const at = new Map(merged.map((attachment, index) => [attachmentKey(attachment), index]));

  for (const attachment of added) {
    const key = attachmentKey(attachment);
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, merged.length);
      merged.push(attachment);
    } else if (attachment.kind === "board") {
      merged[seen] = attachment;
    }
  }

  return merged;
}

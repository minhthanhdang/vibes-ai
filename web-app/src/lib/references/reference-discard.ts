import type { ReferenceOrigin } from "@/generated/prisma/enums";
import { isGeneratedOrigin } from "@/lib/references/reference-filter";
import { usingPagesSaid, type UsingBoard } from "@/lib/references/reference-usage";

export type DiscardedReference = {
  referenceId: string;
  title: string;
  frameId?: string | null;
  cuts?: number;
  boards?: UsingBoard[];
  origin?: ReferenceOrigin | null;
};

export function pictureNoun(origin?: ReferenceOrigin | null) {
  return isGeneratedOrigin(origin) ? "drawn picture" : "photograph";
}

export function referenceDiscardKey(referenceId: string) {
  return `reference:${referenceId}`;
}

const BOARDS_NAMED = 2;

export function discardedReferenceNote(reference: DiscardedReference) {
  const title = reference.title.trim() || "Untitled";
  const noun = pictureNoun(reference.origin);
  const what = reference.frameId ? "cut" : noun;
  const frame = reference.frameId
    ? ` The ${noun} it was cut from (${reference.frameId}) is still in the gallery.`
    : "";
  const cuts =
    reference.frameId || !reference.cuts
      ? ""
      : reference.cuts === 1
        ? " The cut made of it went with it."
        : ` The ${reference.cuts} cuts made of it went with it.`;

  return `I removed the ${what} “${title}” (${reference.referenceId}) from the project. It is gone, and that id no longer names anything — do not pass it to a tool.${frame}${cuts}${gapNote(reference.boards ?? [])}`;
}

function gapNote(boards: readonly UsingBoard[]) {
  if (!boards.length) return "";
  const named = boards
    .slice(0, BOARDS_NAMED)
    .map(
      (board) =>
        `“${board.title.trim() || "Untitled board"}” (${board.id})${usingPagesSaid(board)}`,
    );
  const rest = boards.length - named.length;
  const list = rest ? `${named.join(", ")} and ${rest} more` : named.join(" and ");
  const paged = boards.slice(0, BOARDS_NAMED).some((board) => board.pages?.length);
  return ` ${boards.length === 1 ? "The board" : "The boards"} it was on — ${list} — ${
    boards.length === 1 ? "now has" : "now have"
  } a gap where it was: offer to put another picture in its place with design_page${
    paged
      ? ", passing the pageId named beside the board so the replacement lands on the page the hole is on"
      : ""
  }, and do not say the boards are unchanged.`;
}

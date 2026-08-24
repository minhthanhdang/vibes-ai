import { boardContents } from "@/lib/boards/board-contents";
import { boardPages, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import {
  pageContents,
  pageDigests,
  picturesOffPages,
  type PageDigest,
  type PagePicture,
} from "@/lib/pages/page-contents";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// What a design comes back having *made*, read off the board rather than off
/// the loop (compositor-v2.md §VI).
///
/// Agent 8's own answer is a closing line and a list of tool names. That is
/// less than `compose_moodboard` used to hand agent 6 — which said which
/// pictures landed, which were left off and what the page is — and the gap is
/// not agent 8's to close: it does not read the board back after its last
/// write, and asking it to would be a thirteenth round spent describing work
/// it just did. So the read is the door's, and this is the pure half of it.
///
/// Pure and free of the database for `designAsk`'s reason: this paragraph is
/// what agent 6 tells the user about a page nothing else in the turn watched
/// being made, and it is worth being able to assert on without a scene in a
/// row.
///
/// Every field comes out of a reader that already exists — `pageDigests`,
/// `pageContents`, `picturesOffPages`, `boardContents`. Nothing here counts
/// anything itself.

export type DesignReport = {
  /// The page the design worked on, when it can be named. Absent on the one
  /// case that cannot be resolved: a board of several pages nobody named, where
  /// which one the model chose is a fact only the scene it wrote knows.
  page?: PageDigest;
  /// Every page of the board, in place of the one page — so an answer that
  /// cannot say which page was designed can at least say which pages there are.
  pages?: PageDigest[];
  /// The pictures on it, in reading order, with the ones drawn cut off at the
  /// page's edge marked. Board-wide when there is no page to scope it to.
  placed: PagePicture[];
  lines: string[];
  /// The picture standing behind the page, which is a placement the user reads
  /// as a background rather than as one of the pictures on it.
  background: string | null;
  /// Pictures agent 6 named that are not on the page. Not a fault — agent 8
  /// chooses for itself and a picture left off is a decision — but agent 6 has
  /// to know before it writes a reply describing the page as holding them.
  notPlaced?: string[];
  /// Pictures on the board sitting on no page at all. A design that placed
  /// something beside the page rather than on it is the one failure this whole
  /// report exists to make visible.
  looseOnBoard?: string[];
  /// What the design drew and cut on the way, by the ledgers the two tools
  /// keep. A drawn backdrop is the one thing in the gallery the user cannot
  /// tell by looking, so it is the one thing agent 6 has to say out loud.
  made?: { generated?: readonly string[]; cropped?: readonly string[] };
};

export function designReport({
  elements,
  pageId,
  named = [],
  made,
}: {
  elements: readonly SceneElement[];
  /// The page the design was on, resolved by the door: the one agent 6 named,
  /// or the one the model made, or the board's only page. Null when it is none
  /// of those.
  pageId: string | null;
  /// The ids agent 6 passed as `imageIds`, which is the only set `notPlaced`
  /// can be honest about — the gallery is agent 8's to choose from and a
  /// picture it never wanted is not one it left off.
  named?: readonly string[];
  made?: { generated: readonly string[]; cropped: readonly string[] };
}): DesignReport {
  const pages = pagesInReadingOrder(boardPages(elements));
  const on = pageId ? pageById(pages, pageId) : null;

  const digests = pageDigests(elements);
  const scoped = on ? pageContents(elements, on) : null;

  /// Board-wide when no page could be named, rather than empty: the pictures
  /// really are somewhere, and a report that said "nothing was placed" about a
  /// page it could not find is a lie agent 6 would pass straight on.
  const wide = scoped ? null : boardContents(elements);

  const placed: PagePicture[] = scoped
    ? scoped.pictures
    : wide!.pictures.map((referenceId) => ({ referenceId, clipped: false }));

  const here = new Set(placed.map(({ referenceId }) => referenceId));
  const notPlaced = named.filter((id) => id && !here.has(id));

  const loose = picturesOffPages(elements, pages);

  const generated = made?.generated ?? [];
  const cropped = made?.cropped ?? [];

  return {
    ...(on ? { page: digests.find(({ pageId: id }) => id === on.id)! } : { pages: digests }),
    placed,
    lines: scoped ? scoped.lines : wide!.lines,
    background: scoped ? scoped.background : null,
    ...(notPlaced.length && { notPlaced }),
    ...(loose.length && { looseOnBoard: loose }),
    ...((generated.length || cropped.length) && {
      made: {
        ...(generated.length && { generated }),
        ...(cropped.length && { cropped }),
      },
    }),
  };
}

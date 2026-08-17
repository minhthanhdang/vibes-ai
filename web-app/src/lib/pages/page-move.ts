import { elementsOnPage, placeOnPage } from "@/lib/pages/page-place";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";
import type { BoardPage } from "@/lib/pages/board-pages";

/// A picture carried from one page of a board to another (tech-spec §V).
///
/// Pages are what the user organizes by, so "put the stairwell on the second
/// page instead" is a first-class sentence about a board — and until now it had
/// no route. The three calls that could be reached for each answer a different
/// question and all three get this one wrong:
///
/// - `swap_on_board` scoped to the target page puts the picture *in the place of*
///   another one there, and the copy on the page it came from stays. The board
///   then holds the photograph twice, on two pages, and the answer says a swap
///   was made — the one failure a page-scoped read cannot show, because each page
///   read on its own is correct;
/// - `compose_moodboard` with `addReferenceIds` on the target and
///   `removeReferenceIds` on the source is two rebuilds, so both pages come back
///   with every slot reassigned in order to move one photograph;
/// - dragging it is the user's own answer and is not available to the model.
///
/// So this is the third verb of `swapOnBoard`/`placeOnPage`'s field: nothing is
/// laid out again, no model call is made, and the only things that move are the
/// pictures named. It is exactly a removal from one page and a joining of
/// another, which is why it is those two calls in that order rather than a rule
/// of its own — what lands on the target page lands where a picture joining that
/// page lands, at the size that page's own pictures are, inside it and owned by
/// its frame.
///
/// The picture is *re-placed* rather than translated. A page is a fixed rectangle
/// and the two pages need not be the same shape or hold the same arrangement, so
/// the box a photograph had in page 1's hero slot describes nothing on page 2 —
/// keeping it would drop the picture over whatever is standing there, or off the
/// page altogether when the target is the narrower of the two.
///
/// No canvas, no React, no DOM.

export type PageMove = {
  /// The board's scene afterwards, in the array's own order.
  elements: SceneElement[];
  /// The pictures that came off one page and joined the other, in the order they
  /// were named.
  moved: string[];
  /// Named, on the page it was to come off, and already on the page it was to go
  /// to. It has only been taken off the source — a photograph is not drawn twice
  /// on one page, which is the same refusal a join makes.
  alreadyThere: string[];
  /// Named and on neither the source page nor anywhere this call would look. The
  /// board may well hold it a page away, so this is a pageId to correct rather
  /// than a reference id.
  notOnFrom: string[];
};

/// The named pictures taken off `from` and put on `to`, and nothing else touched.
export function moveToPage({
  elements,
  pages,
  from,
  to,
  referenceIds,
  sizeOf,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  /// Every page of the board: which page holds a box is decided topmost first
  /// across all of them (§V.3), so a page lying over another cannot have its
  /// pictures carried off by a call about the page underneath.
  pages: readonly BoardPage[];
  from: BoardPage;
  to: BoardPage;
  referenceIds: readonly string[];
  sizeOf: (referenceId: string) => { width?: number | null; height?: number | null } | null | undefined;
  makeId?: () => string;
}): PageMove {
  const asked = [...new Set(referenceIds.map((id) => id.trim()).filter(Boolean))];

  const onFrom = new Set(
    elementsOnPage(elements, pages, from)
      .map((element) => referenceIdFromFileId(element.fileId))
      .filter((id): id is string => id !== null),
  );

  const going = asked.filter((id) => onFrom.has(id));
  const notOnFrom = asked.filter((id) => !onFrom.has(id));
  if (!going.length) return { elements: [...elements], moved: [], alreadyThere: [], notOnFrom };

  /// Off first, on second, and the second read against the array the first
  /// returned: a photograph the source page carried twice leaves twice and joins
  /// once, and the join's own "already on this page" refusal is then asked of the
  /// target page as it will actually stand.
  const off = placeOnPage({ elements, pages, page: from, remove: going, sizeOf });
  const on = placeOnPage({ elements: off.elements, pages, page: to, add: going, sizeOf, makeId });

  return { elements: on.elements, moved: on.added, alreadyThere: on.alreadyOn, notOnFrom };
}

import { boardItems, type Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  boardSections,
  isFrameElement,
  pageById,
  pageElements,
  pageItems,
  type BoardPage,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A page taken off a board, and what taking it would cost (tech-spec §V).
///
/// The page entity could be made three ways and unmade none: `add_page` draws an
/// empty one, `compose_moodboard` with `newPage` draws one under an arrangement,
/// and the director marks a frame as one on the canvas. A director who asks for a
/// page they no longer want has been answerable only by `discard_board` — which
/// takes the other pages with it — or by nothing at all.
///
/// What goes is the rectangle and what is standing on it. "Drop the second page"
/// is not a request to unframe eight photographs and leave them lying over each
/// other where the page used to be: the arrangement *is* the thing being dropped.
/// Membership is §V.3's, the same rule every read and the render use, so what the
/// director was shown in the tile is exactly what leaves.
///
/// Two things on the page stay, and they are the two §V.1 says a page never owned:
/// a section the page was drawn over, and the photographs that section holds. A
/// page cannot contain a section — the page is a rectangle drawn around the
/// director's own grouping, and taking their grouping away with it is a loss they
/// did not ask for and cannot see coming from the word "page".
///
/// The same function answers the offer and makes the change, so the count in
/// "you would lose 6 photographs" is produced by the code that then loses them.
///
/// No canvas, no React, no DOM.

export type PageRemovalPicture = {
  referenceId: string;
  /// It ran over the page's edge, so the tile drew it cut off. Said because it is
  /// the one picture on the page the director may believe is somewhere else.
  clipped: boolean;
};

export type PageRemoval = {
  /// The scene as it stands afterwards, in the array's own order.
  elements: SceneElement[];
  page: BoardPage;
  /// One entry per reference, in the page's reading order — what the director
  /// would lose off this page, said as pictures rather than as elements.
  pictures: PageRemovalPicture[];
  lines: string[];
  /// Images on the page naming nothing the project holds, counted rather than
  /// listed for `pageContents`' own reason: there is no id to give back.
  unnamedImages: number;
  /// How many sections the page was drawn over, and how many photographs they
  /// keep. Zero on every page agent 4 composed; the reason a hand-made board's
  /// page can be dropped without the board emptying with it.
  sections: number;
  keptInSections: number;
  /// Whether this was the board's only page. The board is then a canvas with no
  /// page on it — not a deleted board, and the difference is what the director is
  /// deciding between.
  emptiesBoard: boolean;
};

function centreIn(box: Rect, item: Rect) {
  const x = item.x + item.width / 2;
  const y = item.y + item.height / 2;
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/// The page, gone. `null` for an id the board does not carry — the caller refuses
/// it in its own answer, which is a round cheaper than a thrown error.
export function pageRemoval(
  elements: readonly SceneElement[],
  pageId: unknown,
): PageRemoval | null {
  const pages = boardPages(elements);
  const page = pageById(pages, pageId);
  if (!page) return null;

  const sections = boardSections(elements, pages);
  /// Everything the page is holding by §V.3, section-owned photographs aside —
  /// the same set `pageDuplication` copies, so what a discard takes is exactly
  /// what a copy of that page would have carried.
  const going = pageElements(elements, pages, page, sections);
  const gone = new Set(going.map((element) => element.id));
  gone.add(page.id);

  const kept = elements
    .filter((element) => !gone.has(element.id))
    /// A photograph the director dragged off the page still names it. The frame
    /// it names is about to stop existing, so the name goes with it — an element
    /// whose `frameId` points at nothing is one excalidraw will not draw a
    /// selection around and one no page read can explain.
    .map((element) => (element.frameId === page.id ? { ...element, frameId: null } : element));

  /// Read off the elements that are leaving rather than off the page, so a
  /// photograph a section keeps is not counted as part of the loss.
  const on = pageItems(boardItems(going), page);
  const pictures: PageRemovalPicture[] = [];
  const at = new Map<string, number>();
  for (const item of on) {
    if (item.kind !== "image" || !item.referenceId) continue;
    const seen = at.get(item.referenceId);
    if (seen === undefined) {
      at.set(item.referenceId, pictures.length);
      pictures.push({ referenceId: item.referenceId, clipped: item.clipped });
      continue;
    }
    pictures[seen]!.clipped ||= item.clipped;
  }

  const onSections = sections.filter((section) => centreIn(page, section));
  const sectionIds = new Set(onSections.map((section) => section.id));

  return {
    elements: kept,
    page,
    pictures,
    lines: on
      .filter((item) => item.kind === "text")
      .map((item) => (item.text ?? "").trim())
      .filter(Boolean),
    unnamedImages: on.filter((item) => item.kind === "image" && !item.referenceId).length,
    sections: onSections.length,
    keptInSections: elements.filter(
      (element) =>
        element.isDeleted !== true &&
        !isFrameElement(element) &&
        typeof element.frameId === "string" &&
        sectionIds.has(element.frameId),
    ).length,
    emptiesBoard: pages.length === 1,
  };
}

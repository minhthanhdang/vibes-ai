import { boardItems, readingOrder, type BoardItem } from "@/lib/boards/board-contents";
import {
  boardPages,
  itemsOnPage,
  pageBackground,
  pageHolding,
  pageItems,
  pagesInReadingOrder,
  type BoardPage,
  type PageSizeLabel,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A board's pages as a *reader* asks for them: the list of them, and what is on
/// one of them.
///
/// `board-pages.ts` is the entity — the rectangle, its size, its membership rule.
/// This is the layer above it, and it exists because the orchestrator can no
/// longer be told "what is on this board" as one flat list: a board is pages now,
/// and a picture beside another one on page 2 says something a board-wide list of
/// eight ids does not.
///
/// Two questions, deliberately separate, because they are the two calls a model
/// makes and the second is the expensive one:
///
/// - which pages are there — name, size and how much is on each, cheap enough to
///   put in every read of a board;
/// - what is on *this* page — the pictures and the lines, in reading order, with
///   the ones running over the edge marked.
///
/// Counts in the list come from the same read the second question answers, so a
/// page listed as holding three pictures and the same page read never disagree.
///
/// No canvas, no React, no DOM.

export type PagePicture = {
  referenceId: string;
  /// The element crosses the page's edge, so the render shows it cut off. A
  /// reader has to be told that is an overflow rather than a crop.
  clipped: boolean;
};

export type PageContents = {
  /// In reading order, one entry per reference — a picture placed twice on one
  /// page is one thing the user can name, and it is clipped if any of its
  /// copies is.
  pictures: PagePicture[];
  /// The picture standing *behind* the page, by the id the project knows it as —
  /// null when the page has none, and null too when what is behind it names
  /// nothing the project holds.
  ///
  /// Apart from `pictures` rather than first in it, which is the whole point of
  /// reading it: a page of five photographs on a sketch holds five photographs,
  /// and a background counted with them makes the card say six, offers the
  /// backdrop to the compositor as a sixth block to seat in a slot, and reads
  /// back to the user as a photograph they never put there.
  background: string | null;
  lines: string[];
  /// How many rectangles, ellipses and rules are on it (§XI.5). Counted rather
  /// than listed, and counted apart from the pictures: a colour block is part
  /// of what a page holds — a page of two photographs on a colour field is not
  /// a page holding two things — but it is not a picture, and a count that
  /// added them together would offer the compositor a scrim as a third block.
  shapes: number;
  /// Images on the page naming nothing the project holds. Counted rather than
  /// listed for the same reason `boardContents` counts them: there is no id to
  /// give back and no tool that would take one.
  unnamedImages: number;
};

export type PageDigest = {
  pageId: string;
  name: string;
  /// Reading order, 1-based: "the second page" is this number.
  position: number;
  of: number;
  width: number;
  height: number;
  preset: PageSizeLabel;
  pictures: number;
  lines: number;
  shapes: number;
  clipped: number;
};

/// What is on one page (§V.3), said the way the user would say it.
///
/// The same shape `boardContents` returns for a whole board, so a page read and a
/// board read describe a picture in one vocabulary — plus the one fact only a
/// page has, which is that an element can hang over its edge.
export function pageContents(elements: readonly SceneElement[], page: BoardPage): PageContents {
  return pageContentsOf(boardItems(elements, { shapes: true }), boardPages(elements), page);
}

function pageContentsOf(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  page: BoardPage,
): PageContents {
  const on = pageItems(itemsOnPage(items, pages, page), page);
  /// Lifted out before anything is counted, so every reader below this line —
  /// the count on the card, the listing `inspect_board` shows, the set a rebuild
  /// gathers to lay out again — agrees about it without having to be told.
  const behind = pageBackground(on, page);

  const pictures: PagePicture[] = [];
  const at = new Map<string, number>();
  for (const item of on) {
    if (item === behind) continue;
    if (item.kind !== "image" || !item.referenceId) continue;
    const seen = at.get(item.referenceId);
    if (seen === undefined) {
      at.set(item.referenceId, pictures.length);
      pictures.push({ referenceId: item.referenceId, clipped: item.clipped });
      continue;
    }
    pictures[seen]!.clipped ||= item.clipped;
  }

  return {
    pictures,
    background: behind?.referenceId ?? null,
    shapes: on.filter((item) => item.kind === "shape").length,
    lines: on
      .filter((item) => item.kind === "text")
      .map((item) => (item.text ?? "").trim())
      .filter(Boolean),
    unnamedImages: on.filter(
      (item) => item !== behind && item.kind === "image" && !item.referenceId,
    ).length,
  };
}

/// The board's pages in reading order, each with enough on it to choose one by.
///
/// Name, size and how much it holds — not what it holds. A board of four pages
/// listing every picture on every page is the flat list pages were introduced to
/// stop being the only way to read a board, and it is paid on a call that was
/// asked which pages there are.
export function pageDigests(elements: readonly SceneElement[]): PageDigest[] {
  const pages = pagesInReadingOrder(boardPages(elements));
  const items = boardItems(elements, { shapes: true });

  return pages.map((page, index) => {
    const { pictures, lines, shapes } = pageContentsOf(items, pages, page);
    return {
      pageId: page.id,
      name: page.name,
      position: index + 1,
      of: pages.length,
      width: page.width,
      height: page.height,
      preset: page.preset,
      pictures: pictures.length,
      lines: lines.length,
      shapes,
      clipped: pictures.filter((picture) => picture.clipped).length,
    };
  });
}

/// The pictures sitting on no page at all — dropped beside the board, or left
/// behind when a page was dragged off them.
///
/// Said rather than left out: a board read page by page would otherwise describe
/// every picture except these, and a picture nobody can see in any page read is
/// worse than one listed as loose on the canvas.
export function picturesOffPages(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
): string[] {
  if (pages.length === 0) return [];

  const loose: string[] = [];
  const seen = new Set<string>();
  for (const item of readingOrder(boardItems(elements))) {
    if (item.kind !== "image" || !item.referenceId) continue;
    if (seen.has(item.referenceId) || pageHolding(pages, item)) continue;
    seen.add(item.referenceId);
    loose.push(item.referenceId);
  }
  return loose;
}

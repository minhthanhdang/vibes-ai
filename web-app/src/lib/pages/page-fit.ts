import type { BoardItem } from "@/lib/boards/board-contents";
import type { MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import type { CropShape } from "@/lib/references/reference-version";
import { looseFits, scenePlacements, slotShapeFor, type LooseFit } from "@/lib/layout/slot-fit";
import { pagesInReadingOrder, type BoardPage } from "@/lib/pages/board-pages";
import { pageLocalItems } from "@/lib/pages/page-compose";

/// Reading a board's slots when the board is pages (tech-spec §V.1, §V.3).
///
/// A template's slot rectangles are constants cut against the origin, and
/// `scenePlacements` pairs a stored element with one by geometry alone. That
/// works on a board whose single page sits at (0,0) and silently answers nothing
/// on every page past it: a picture on page 2 is a thousand units to the right of
/// any slot, so it is never seated, never measured and never reported.
///
/// Silence is the safe direction — a fit nobody can see is better than a fit
/// against a slot nobody is using — but it is still a page whose questions cannot
/// be answered. "Does this board fit" comes back empty for page 2, and a crop
/// asked for a picture on page 2 is held to the nearest of six names rather than
/// to the opening it is filling. `page-compose.ts` fixed this for the *write*
/// side (a compose reads its page in the page's own coordinates before deciding
/// what still sits in a slot); this is the same translation for the readers.
///
/// One rule, applied per page: read each page in its own corner's coordinates and
/// measure there. A board with no page frame is read flat, exactly as it was —
/// which is also what keeps the ordinary one-page board's answers identical.
///
/// Pictures on no page are left out on a board that has pages. They are on the
/// canvas beside the arrangement rather than in it (`picturesOffPages`), so there
/// is no slot they could be sitting in.
///
/// No canvas, no React, no DOM.

/// A loose fit, said with the page it is on when the board has more than one.
///
/// Named only when it disambiguates: on a board with one page, or on a read
/// already scoped to a page, the answer says which page it is about and repeating
/// it on every line would be the same fact bought per picture.
export type PagedLooseFit = LooseFit & { pageId?: string; page?: string };

/// Which pictures sit loosely in their slots, measured page by page.
///
/// Worst fit first across the whole board, keeping `looseFits`' own order: the
/// orchestrator is being asked to name them in a sentence, and the worst one is
/// the sentence whether it is on page 1 or page 3.
export function pagedLooseFits(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout,
): PagedLooseFit[] {
  const ordered = pagesInReadingOrder(pages);
  if (ordered.length === 0) return looseFits(scenePlacements(items, layout));

  const named = ordered.length > 1;
  const loose = ordered.flatMap((page) =>
    looseFits(scenePlacements(pageLocalItems(items, page), layout)).map((fit) => ({
      ...fit,
      ...(named && { pageId: page.id, page: page.name }),
    })),
  );
  return loose.sort((a, b) => a.fills - b.fills);
}

/// The opening a picture is sitting in, wherever on the board it is sitting.
///
/// The first page holding it in a slot wins. A reference placed on two pages is
/// one row in the catalogue and one cut — the shapes only differ if the director
/// put it in two differently shaped slots, and reading order is the order they
/// would name them in.
export function pagedSlotShape(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout,
  referenceId: string,
): { slotId: string; shape: CropShape } | null {
  const ordered = pagesInReadingOrder(pages);
  if (ordered.length === 0) return slotShapeFor(items, layout, referenceId);

  for (const page of ordered) {
    const opening = slotShapeFor(pageLocalItems(items, page), layout, referenceId);
    if (opening) return opening;
  }
  return null;
}

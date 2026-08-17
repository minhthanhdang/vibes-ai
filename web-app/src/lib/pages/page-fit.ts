import type { BoardItem } from "@/lib/boards/board-contents";
import type { MoodboardLayout, Placement } from "@/lib/layout/moodboard-layouts";
import type { CropShape } from "@/lib/references/reference-version";
import {
  looseFits,
  scenePlacements,
  slotShapeFor,
  standsAsComposed,
  type LooseFit,
} from "@/lib/layout/slot-fit";
import { itemsOnPage, pagesInReadingOrder, type BoardPage } from "@/lib/pages/board-pages";
import { layoutForPage, pageLocalItems } from "@/lib/pages/page-compose";

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
/// measure there, against the template as that page draws it — a page the
/// director resized carries the arrangement fitted to their rectangle
/// (`layoutForPage`), so a reader holding it to the template's own page size
/// would find nothing seated on a page that is standing perfectly well. A board
/// with no page frame is read flat, exactly as it was — which is also what keeps
/// the ordinary one-page board's answers identical.
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
  const loose = ordered.flatMap((page) => {
    const on = scenePlacements(
      pageLocalItems(itemsOnPage(items, ordered, page), page),
      layoutForPage(layout, page),
    );
    return looseFits(on).map((fit) => ({
      ...fit,
      ...(named && { pageId: page.id, page: page.name }),
    }));
  });
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
    const on = pageLocalItems(itemsOnPage(items, ordered, page), page);
    const opening = slotShapeFor(on, layoutForPage(layout, page), referenceId);
    if (opening) return opening;
  }
  return null;
}

/// Which pictures are sitting in slots, with each slot said in the board's own
/// coordinates rather than the page's.
///
/// The other two readers here only ever ask a slot's *shape*, which the
/// translation cannot change — so they measure inside the page and are done.
/// This one is for a caller that has to draw: `swapOnBoard` re-fits the incoming
/// picture to the opening the outgoing one was in, and a box computed against a
/// slot cut at the origin would land the replacement on page 1 whatever page the
/// exchange was about. So the page's corner is added back, and what comes out is
/// the rectangle the slot occupies on the board.
export function pagedPlacements(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout,
): Placement[] {
  const ordered = pagesInReadingOrder(pages);
  if (ordered.length === 0) return scenePlacements(items, layout);

  return ordered.flatMap((page) =>
    scenePlacements(
      pageLocalItems(itemsOnPage(items, ordered, page), page),
      layoutForPage(layout, page),
    ).map(
      ({ slot, block }) => ({
        slot: { ...slot, x: slot.x + page.x, y: slot.y + page.y },
        block,
      }),
    ),
  );
}

/// Is this board still the arrangement its template composed, page by page?
///
/// The board carries one template id, so the question a caption asks of a spread
/// is whether *every* page of it is still standing in that template. Read flat, a
/// two-page board never is — no picture past page 1 is seated in anything — and
/// the tile the director is shown loses the layout name the moment their board
/// grows a second page.
///
/// A picture on no page counts against it. It is on the canvas beside the
/// arrangement rather than in it, which is exactly the case the flat rule calls
/// "dragged out of its slot".
export function pagedStandsAsComposed(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout | null,
): boolean {
  if (!layout) return false;
  if (pages.length === 0) return standsAsComposed(items, layout);

  const pictures = items.filter(
    (item) => item.kind === "image" && typeof item.referenceId === "string" && item.referenceId,
  );
  if (!pictures.length) return false;

  return pagedPlacements(items, pages, layout).length === pictures.length;
}

/// Is *this* page still the arrangement that template composed?
///
/// The board-wide question above is the one a caption about a whole board asks.
/// Every sentence written about one page asks the narrower one, and the two
/// disagree exactly where a spread is interesting: the board carries a single
/// template id (§V.1 — the row describes its *first* page), so page 2 of a board
/// composed at `HERO_LEFT` may have been laid out at `MASONRY`, added empty by
/// `add_page`, or dragged apart since, and the row still says `HERO_LEFT`.
///
/// Written here rather than at each caller because it is asked in two places now
/// — the tile the director is shown and the words the model is given — and a
/// tile that keeps the template name while the text drops it is one page
/// described two ways in one reply.
///
/// Takes the board's pages beside the one being asked about, because a picture in
/// the overlap of two of them is only this page's if this page is the one holding
/// it (§V.3): counted here as well, a page would be pulled out of its template by
/// a photograph the page beside it owns.
export function pageStandsAsComposed(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  page: BoardPage,
  layout: MoodboardLayout | null,
): boolean {
  return pagedStandsAsComposed(itemsOnPage(items, pages, page), [page], layout);
}

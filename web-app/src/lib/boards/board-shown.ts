import { boardAttachmentOf, type BoardAttachment } from "@/lib/agent/agent-tools";
import { boardContents, boardItems, sceneBounds } from "@/lib/boards/board-contents";
import { scenePreview } from "@/lib/boards/board-preview";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, boxOnPage, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageContents } from "@/lib/pages/page-contents";
import { pagedStandsAsComposed, pageStandsAsComposed } from "@/lib/pages/page-fit";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A board the director is being shown, out of its own stored scene.
///
/// Three doors now put the same tile in the chat — the read (`inspect_board`),
/// the swap the model makes, and the swap the browser makes when a cut asked for
/// a board is taken — and one board has one name, so the naming rule lives here
/// rather than three times over. What the caption says is the template the board
/// is standing in for as long as every picture on it is still in a slot of that
/// template, and the page once the director has dragged one out of place — asked
/// page by page, since on a spread the slots are cut against each page's own
/// corner and a flat read would answer "rearranged" for a board nobody touched.
///
/// A `pageId` draws one page of it instead (§V). The answers this tile rides
/// with are page-scoped now — a read of page 2, a swap on page 2, a picture put
/// on page 2 — and a miniature of the whole spread under a sentence about one
/// page shows the director four pages and leaves them to work out which one
/// moved. So the picture is the page rect alone, the counts are that page's, and
/// the caption names it. The page's own rectangle is the frame the render is cut
/// to, so a picture hanging over the edge is drawn running off the tile exactly
/// as excalidraw draws it running off the page.
///
/// Pure: the scene decides everything except the thumbnails, which are signed
/// URLs the caller holds.
export function boardShown({
  board,
  elements,
  thumbUrlOf,
  pageId,
  discard = false,
  discardsPage = false,
}: {
  board: {
    id: string;
    title: string;
    widthPx: number;
    heightPx: number;
    layout?: string | null;
    /// The geometry behind a `CUSTOM` layout, straight off the row. Without it a
    /// board laid out from a layout image has no template to be standing in, so
    /// the tile under the reply would call it rearranged the moment it was
    /// composed.
    layoutSlots?: unknown;
  };
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  /// The page the answer is about, when it is about one. An id the board does
  /// not carry falls back to the whole board rather than to an empty tile — the
  /// caller has already refused it in the answer, and a blank picture beside a
  /// refusal reads as the board having been emptied.
  pageId?: string | null;
  /// Whether the tile carries a Discard button. The fourth door, and the only
  /// one that is a question rather than a report — it shows the board the same
  /// way the other three do, because what is being decided is precisely whether
  /// to keep *that*.
  discard?: boolean;
  /// Whether that button takes the page rather than the board (`discard_page`).
  /// Only meaningful beside a `pageId` that resolves: the offer names the page
  /// the tile is drawn from, and a tile that fell back to the whole board is not
  /// of a page for the button to take.
  discardsPage?: boolean;
}): BoardAttachment {
  const items = boardItems(elements);
  const layout = boardLayout(board);
  const standing = pagesInReadingOrder(boardPages(elements));
  const on = pageId ? pageById(standing, pageId) : null;

  if (on) {
    /// The scene array's order rather than reading order, because this is what
    /// the miniature stacks: a collage's overlap is what array order carries.
    ///
    /// The rectangle's own rule rather than §V.3's topmost-page one, because this
    /// is the half of the tile that stands in for the render: excalidraw draws a
    /// picture wherever it lies, so one in the overlap of two pages is on screen
    /// inside both of them and a miniature that left it out would be of a page
    /// the director cannot see.
    const onPage = items.filter((item) => boxOnPage(on, item));
    const { pictures, lines } = pageContents(elements, on);

    return boardAttachmentOf({
      id: board.id,
      title: board.title,
      /// Asked of this page alone: on a spread the other pages are not what the
      /// sentence beside this tile is about, and a picture dragged off page 3
      /// should not take page 2's name away.
      ...(pageStandsAsComposed(items, standing, on, layout) && layout && { layout: layout.id }),
      /// The rectangle as it stands, not the board's default page: a spread can
      /// hold a portrait page beside a landscape one.
      page: { width: on.width, height: on.height },
      onPage: { name: on.name, position: standing.indexOf(on) + 1, of: standing.length },
      images: pictures.length,
      lines,
      thumbUrl: pictures.map(({ referenceId }) => thumbUrlOf(referenceId)).find(Boolean) ?? null,
      preview: scenePreview(onPage, on, thumbUrlOf),
      discard,
      ...(discardsPage && { discardPage: { pageId: on.id, name: on.name } }),
    });
  }

  const { pictures, lines } = boardContents(elements);
  const page = { width: board.widthPx, height: board.heightPx };

  return boardAttachmentOf({
    id: board.id,
    title: board.title,
    ...(pagedStandsAsComposed(items, standing, layout) && layout && { layout: layout.id }),
    page,
    images: pictures.length,
    /// In reading order, the same order the pictures are numbered in — so the
    /// line the tile shows first is the line at the top of the board.
    lines,
    /// The first picture in reading order, as the cover a board that has never
    /// been drawn shows. A board with nothing on it has none, which the tile
    /// draws as the placeholder.
    thumbUrl: pictures.map((id) => thumbUrlOf(id)).find(Boolean) ?? null,
    preview: scenePreview(items, sceneBounds(items, page), thumbUrlOf),
    discard,
  });
}

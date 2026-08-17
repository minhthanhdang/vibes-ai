import { boardAttachmentOf, type BoardAttachment } from "@/lib/agent/agent-tools";
import { boardContents, boardItems, sceneBounds } from "@/lib/boards/board-contents";
import { scenePreview } from "@/lib/boards/board-preview";
import { layoutById } from "@/lib/layout/moodboard-layouts";
import { boardPages } from "@/lib/pages/board-pages";
import { pagedStandsAsComposed } from "@/lib/pages/page-fit";
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
/// Pure: the scene decides everything except the thumbnails, which are signed
/// URLs the caller holds.
export function boardShown({
  board,
  elements,
  thumbUrlOf,
  discard = false,
}: {
  board: {
    id: string;
    title: string;
    widthPx: number;
    heightPx: number;
    layout?: string | null;
  };
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  /// Whether the tile carries a Discard button. The fourth door, and the only
  /// one that is a question rather than a report — it shows the board the same
  /// way the other three do, because what is being decided is precisely whether
  /// to keep *that*.
  discard?: boolean;
}): BoardAttachment {
  const items = boardItems(elements);
  const { pictures, lines } = boardContents(elements);
  const page = { width: board.widthPx, height: board.heightPx };
  const layout = layoutById(board.layout ?? null);

  return boardAttachmentOf({
    id: board.id,
    title: board.title,
    ...(pagedStandsAsComposed(items, boardPages(elements), layout) &&
      layout && { layout: layout.id }),
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

import { boardAttachmentOf, type BoardAttachment } from "./agent-tools";
import { boardContents, boardItems, sceneBounds } from "./board-contents";
import { scenePreview } from "./board-preview";
import { layoutById } from "./moodboard-layouts";
import { standsAsComposed } from "./slot-fit";
import type { SceneElement } from "./moodboard-scene";

/// A board the director is being shown, out of its own stored scene.
///
/// Three doors now put the same tile in the chat — the read (`inspect_board`),
/// the swap the model makes, and the swap the browser makes when a cut asked for
/// a board is taken — and one board has one name, so the naming rule lives here
/// rather than three times over. What the caption says is the template the board
/// is standing in for as long as every picture on it is still in a slot of that
/// template, and the page once the director has dragged one out of place.
///
/// Pure: the scene decides everything except the thumbnails, which are signed
/// URLs the caller holds.
export function boardShown({
  board,
  elements,
  thumbUrlOf,
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
}): BoardAttachment {
  const items = boardItems(elements);
  const { pictures } = boardContents(elements);
  const page = { width: board.widthPx, height: board.heightPx };
  const layout = layoutById(board.layout ?? null);

  return boardAttachmentOf({
    id: board.id,
    title: board.title,
    ...(standsAsComposed(items, layout) && layout && { layout: layout.id }),
    page,
    images: pictures.length,
    /// The first picture in reading order, as the cover a board that has never
    /// been drawn shows. A board with nothing on it has none, which the tile
    /// draws as the placeholder.
    thumbUrl: pictures.map((id) => thumbUrlOf(id)).find(Boolean) ?? null,
    preview: scenePreview(items, sceneBounds(items, page), thumbUrlOf),
  });
}

import { type BoardAttachment, boardAttachmentOf } from "@/lib/agent/shared/attachments";
import { boardContents, boardItems, sceneBounds } from "@/lib/boards/board-contents";
import { scenePreview } from "@/lib/boards/board-preview";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, boxOnPage, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageContents } from "@/lib/pages/page-contents";
import { pagedStandsAsComposed, pageStandsAsComposed } from "@/lib/pages/page-fit";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

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
    layoutSlots?: unknown;
  };
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  pageId?: string | null;
  discard?: boolean;
  discardsPage?: boolean;
}): BoardAttachment {
  const items = boardItems(elements);
  const layout = boardLayout(board);
  const standing = pagesInReadingOrder(boardPages(elements));
  const on = pageId ? pageById(standing, pageId) : null;

  if (on) {
    const onPage = items.filter((item) => boxOnPage(on, item));
    const { pictures, lines } = pageContents(elements, on);

    return boardAttachmentOf({
      id: board.id,
      title: board.title,
      ...(pageStandsAsComposed(items, standing, on, layout) && layout && { layout: layout.id }),
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
    lines,
    thumbUrl: pictures.map((id) => thumbUrlOf(id)).find(Boolean) ?? null,
    preview: scenePreview(items, sceneBounds(items, page), thumbUrlOf),
    discard,
  });
}

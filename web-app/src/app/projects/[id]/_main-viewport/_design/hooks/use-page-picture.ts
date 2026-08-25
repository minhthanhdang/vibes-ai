"use client";

import { useCallback, useEffect } from "react";
import { exportToBlob } from "@excalidraw/excalidraw";
import { useTRPCClient } from "@/trpc/react";
import {
  BOARD_RENDER_CONTENT_TYPE,
  BOARD_RENDER_MAX_DIMENSION,
} from "@/lib/scene/moodboard-render";
import { boardPages, isPageElement, pageById } from "@/lib/pages/board-pages";
import { pageExportElements, pagePicture, type PagePicture } from "@/lib/pages/page-picture";
import { holdPageCamera } from "../../../_events/page-camera";
import type { AutosaveState } from "@/lib/scene/moodboard-autosave";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawFrameLikeElement } from "@excalidraw/excalidraw/element/types";

/// Drawing one page of the open board, for a message the user is sending
/// (§V.5.1). The other half of `page-camera`, and the half that needs a canvas.
///
/// Not the board render beside it, which is a preview taken on a timer once the
/// board has gone quiet. This is taken *now*, because the user pressed send,
/// and it is of one rectangle rather than of everything on the scene: a page is
/// one picture, and a picture of the whole board is the arrangement of every page
/// at once, which is not what was attached.
///
/// The rectangle is exact. `exportingFrame` sizes the canvas to the frame itself
/// — no padding, no bounding box of what happens to be on it — and takes the
/// elements by overlap rather than by `frameId`, which is the same geometric rule
/// every page read in this codebase uses (§V.3). So the picture the model sees
/// and the blocks the server describes are about the same rectangle, and a photo
/// hanging over the edge is cut off in the render exactly as the text says it is.

export function usePagePicture({
  boardId,
  editor,
  editorReady,
  state,
  flushSaves,
}: {
  boardId: string;
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
  /// The editor hands its API back after it has mounted; until then there is
  /// nothing to draw with, and an unreadable scene reads as an empty one.
  editorReady: boolean;
  /// The autosave's own reference, read *after* the flush rather than at render
  /// time: what a picture is labelled with is the revision the save just landed,
  /// which the value this component last rendered with cannot know.
  state: React.RefObject<AutosaveState>;
  /// Cuts the debounce short and resolves once the write it started has landed.
  /// A page is drawn only after it, because the server builds everything it says
  /// about the page from the *stored* scene: without the flush, the picture is of
  /// the board as it is and the words are of the board as it was.
  flushSaves: () => Promise<void>;
}) {
  const client = useTRPCClient();

  const draw = useCallback(
    async (
      api: ExcalidrawImperativeAPI,
      pageId: string,
      revision: number,
    ): Promise<PagePicture | null> => {
      const elements = api.getSceneElements();
      /// The frame as excalidraw holds it, not as `boardPages` describes it: the
      /// exporter is given the element. A page deleted between picking and
      /// sending is gone from here, and the page goes up as text — the server
      /// drops it entirely, since there is no rectangle left to describe either.
      const frame = elements.find((element) => element.id === pageId && isPageElement(element));
      const page = pageById(boardPages(elements), pageId);
      if (!frame || !page) return null;

      const blob = await exportToBlob({
        elements: pageExportElements(elements, page),
        /// Always drawn, as the board render's is: a page exported without a
        /// background is a collage on whatever the model's viewer puts behind it.
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        mimeType: BOARD_RENDER_CONTENT_TYPE,
        /// The board render's cap (§V.4): a page is a fraction of a board, so
        /// this is a 1:1 render of an ordinary one and a downscale of a page the
        /// user drew large.
        maxWidthOrHeight: BOARD_RENDER_MAX_DIMENSION,
        /// The editor's elements are ordered ones and the exporter's frame
        /// parameter is not, which is the only thing this says.
        exportingFrame: frame as ExcalidrawFrameLikeElement,
      });

      /// Signed per page and per revision, and refused if the board has moved
      /// since the flush — so this is also the check that the scene the server
      /// will describe is the scene that was just drawn.
      const { url, contentType, uri } = await client.moodboard.pageRenderUploadUrl.mutate({
        id: boardId,
        pageId,
        revision,
      });
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob,
      });
      if (!put.ok) throw new Error(`page render upload failed: ${put.status}`);

      return { boardId, pageId, revision, renderUri: uri };
    },
    [boardId, client],
  );

  /// The canvas half of `pagePicture`: settle the save, say where the autosave
  /// has landed, draw. How many times each of those is asked is that function's
  /// (§V.5's one re-render), and the editor is re-read on every attempt because
  /// the second one happens after an await on a tab the user is still using.
  const take = useCallback(
    (pageId: string): Promise<PagePicture | null> =>
      pagePicture({
        flush: flushSaves,
        saved: () => state.current,
        draw: (revision) => {
          const api = editor.current;
          return api ? draw(api, pageId, revision) : Promise.resolve(null);
        },
      }),
    [draw, editor, flushSaves, state],
  );

  useEffect(() => {
    if (!editorReady) return;
    return holdPageCamera(boardId, take);
  }, [boardId, editorReady, take]);
}

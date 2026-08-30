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

export function usePagePicture({
  boardId,
  editor,
  editorReady,
  state,
  flushSaves,
}: {
  boardId: string;
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
  editorReady: boolean;
  state: React.RefObject<AutosaveState>;
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
      const frame = elements.find((element) => element.id === pageId && isPageElement(element));
      const page = pageById(boardPages(elements), pageId);
      if (!frame || !page) return null;

      const blob = await exportToBlob({
        elements: pageExportElements(elements, page),
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        mimeType: BOARD_RENDER_CONTENT_TYPE,
        maxWidthOrHeight: BOARD_RENDER_MAX_DIMENSION,
        exportingFrame: frame as ExcalidrawFrameLikeElement,
      });

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

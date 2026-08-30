"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { exportToBlob } from "@excalidraw/excalidraw";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import {
  BOARD_RENDER_CONTENT_TYPE,
  BOARD_RENDER_DELAY_MS,
  BOARD_RENDER_MAX_DIMENSION,
  BOARD_RENDER_PADDING,
  boardRenderNeeded,
} from "@/lib/scene/moodboard-render";
import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export function useBoardRender({
  boardId,
  projectId,
  editor,
  editorReady,
  status,
  revision,
  renderedRevision,
}: {
  boardId: string;
  projectId: string;
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
  editorReady: boolean;
  status: AutosaveStatus;
  revision: number;
  renderedRevision: number | null;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const [rendered, setRendered] = useState(renderedRevision);
  const attempted = useRef<number | null>(null);
  const running = useRef(false);

  const render = useCallback(
    async (at: number) => {
      const api = editor.current;
      if (!api || running.current) return;

      const elements = api.getSceneElements();
      if (elements.length === 0) return;

      running.current = true;
      attempted.current = at;
      try {
        const blob = await exportToBlob({
          elements,
          appState: { ...api.getAppState(), exportBackground: true },
          files: api.getFiles(),
          mimeType: BOARD_RENDER_CONTENT_TYPE,
          exportPadding: BOARD_RENDER_PADDING,
          maxWidthOrHeight: BOARD_RENDER_MAX_DIMENSION,
        });

        const { url, contentType } = await client.moodboard.renderUploadUrl.mutate({ id: boardId });
        const put = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: blob,
        });
        if (!put.ok) throw new Error(`render upload failed: ${put.status}`);

        await client.moodboard.saveRender.mutate({ id: boardId, revision: at });
        setRendered(at);
        void queryClient.invalidateQueries({
          queryKey: trpc.moodboard.listByProject.queryOptions({ projectId }).queryKey,
        });
      } catch (cause) {
        console.error(`board ${boardId} render failed:`, cause);
      } finally {
        running.current = false;
      }
    },
    [boardId, client, editor, projectId, queryClient, trpc],
  );

  useEffect(() => {
    if (
      !editorReady ||
      !boardRenderNeeded({
        status,
        revision,
        renderedRevision: rendered,
        attemptedRevision: attempted.current,
        elementCount: editor.current?.getSceneElements().length ?? 0,
      })
    ) {
      return;
    }

    const timer = setTimeout(() => void render(revision), BOARD_RENDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [editor, editorReady, render, rendered, revision, status]);
}

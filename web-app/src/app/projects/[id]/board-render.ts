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
} from "@/lib/moodboard-render";
import type { AutosaveStatus } from "@/lib/moodboard-autosave";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/// A board is stored as an element array, and nothing outside the editor can
/// read one: the tab row cannot show what a board looks like, and agent 5 cannot
/// build a deck out of it. So the tab that *is* showing the board draws it once
/// the scene has settled — a canvas is the only thing that can, and this is the
/// only place there is one.
///
/// Taken on a settled, saved board and labelled with the revision it is of, so a
/// picture is never of a scene the server does not hold.

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
  /// The editor hands its API back after it has mounted, so a board that opens
  /// already needing a picture has to wait for it — the scene is unreadable
  /// until then, and an unreadable scene reads as an empty one.
  editorReady: boolean;
  status: AutosaveStatus;
  revision: number;
  renderedRevision: number | null;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  /// What the server holds once this tab has taken a picture of its own, and the
  /// revision the last attempt was made at — a render that failed is retried
  /// when the board changes again rather than every quiet period forever.
  const [rendered, setRendered] = useState(renderedRevision);
  const attempted = useRef<number | null>(null);
  const running = useRef(false);

  const render = useCallback(
    async (at: number) => {
      const api = editor.current;
      if (!api || running.current) return;

      /// The elements the editor is showing rather than the ones the last save
      /// carried: they are the same scene at this point, and only the editor has
      /// them in the shape the exporter wants.
      const elements = api.getSceneElements();
      if (elements.length === 0) return;

      running.current = true;
      attempted.current = at;
      try {
        const blob = await exportToBlob({
          elements,
          /// The board's own background, and always drawn: a preview with a
          /// transparent background is a photo collage on whatever is behind it.
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
        /// The tab row reads the picture's URL off the board list, and the URL
        /// carries the revision — so without this the row keeps showing the
        /// previous render until something else refetches it.
        void queryClient.invalidateQueries({
          queryKey: trpc.moodboard.listByProject.queryOptions({ projectId }).queryKey,
        });
      } catch (cause) {
        /// Not surfaced on the canvas, unlike a failed save or a failed
        /// adoption: nothing the director made is at risk — the scene is stored
        /// either way, and the only cost is a stale preview.
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

    /// The timer restarts on every save, so a board being actively arranged is
    /// never rendered mid-arrangement — and opening a board whose picture is
    /// behind is itself a long enough pause to take a new one.
    const timer = setTimeout(() => void render(revision), BOARD_RENDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [editor, editorReady, render, rendered, revision, status]);
}

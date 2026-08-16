"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { remoteImageFailureMessage } from "@/lib/remote-image";
import type { ScenePoint } from "@/lib/moodboard-drop";
import { placeReferences } from "./board-references";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/// An image dragged onto the board from another page. What crossed the drag is a
/// URL, and the browser cannot turn it into bytes — a cross-origin image renders
/// but cannot be read — so the server fetches it, stores it as a project
/// reference, and the element that lands is the ordinary `ref:` kind.
///
/// That is the point of importing rather than just pointing at the remote URL:
/// a moodboard built out of hotlinks is a board that empties itself as the pages
/// behind it change, and its photos would be cross-origin, which is what makes
/// exporting the board impossible (see `referenceCanvasImagePath`).

/// The browser can load a cross-origin image even though it cannot read it, so
/// the natural size is measurable here and the row gets the dimensions an
/// uploaded reference has. Capped: an origin that never answers must not leave
/// the import waiting on it.
const MEASURE_TIMEOUT_MS = 5000;

function measureRemoteImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const settle = (size: { width: number; height: number } | null) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(size);
    };
    const timer = setTimeout(() => settle(null), MEASURE_TIMEOUT_MS);

    image.onload = () =>
      settle(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null,
      );
    image.onerror = () => settle(null);
    /// Deliberately not `crossOrigin`: this is a measurement, and asking for CORS
    /// would fail on every origin that does not serve the header — which is most
    /// of them, and all of the ones worth saving from.
    image.src = url;
  });
}

export function useBoardWebImages({
  projectId,
  editor,
}: {
  projectId: string;
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const [importing, setImporting] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  /// The same page dragged twice while the first fetch is still out would buy
  /// two rows for one photo — the server's content-hash dedupe catches it after
  /// the download, this catches it before.
  const inFlight = useRef(new Set<string>());

  const importWebImage = useCallback(
    async (url: string, at: ScenePoint) => {
      if (inFlight.current.has(url)) return;
      inFlight.current.add(url);
      setImporting((count) => count + 1);

      try {
        const measured = await measureRemoteImage(url);
        const reference = await client.reference.importFromUrl.mutate({
          projectId,
          url,
          width: measured?.width,
          height: measured?.height,
        });

        /// Read now rather than captured: the fetch took seconds and the board
        /// may have been closed or switched underneath it.
        const api = editor.current;
        if (!api) return;
        placeReferences(
          api,
          [{ referenceId: reference.id, width: reference.width, height: reference.height }],
          at,
        );

        /// The image is a project reference now, so the sidebar strip and the
        /// gallery are both a list behind.
        void queryClient.invalidateQueries({
          queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
        });
      } catch (error) {
        /// The reason crosses as the error's message; anything else — a dropped
        /// connection, a 500 — falls back to the generic line.
        setFailure(
          remoteImageFailureMessage(error instanceof TRPCClientError ? error.message : null),
        );
      } finally {
        inFlight.current.delete(url);
        setImporting((count) => Math.max(0, count - 1));
      }
    },
    [client, editor, projectId, queryClient, trpc],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);

  return { importWebImage, importing, importFailure: failure, dismissFailure };
}

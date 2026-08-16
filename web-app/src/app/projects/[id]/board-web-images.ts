"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { remoteImageFailureMessage } from "@/lib/remote-image";
import type { ScenePoint } from "@/lib/moodboard-drop";
import { placeReferences } from "./board-references";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/// An image brought onto the board from another page — dragged in, or copied
/// there and pasted. What crossed is a URL, and the browser cannot turn it into
/// bytes: a cross-origin image renders but cannot be read, and fetching it is
/// refused by every CDN that does not serve CORS headers. So the server fetches
/// it, stores it as a project reference, and the element that lands is the
/// ordinary `ref:` kind.
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
  /// The same image brought in twice while the first fetch is still out would
  /// buy two rows for one photo — the server's content-hash dedupe catches it
  /// after the download, this catches it before.
  const inFlight = useRef(new Set<string>());

  const importOne = useCallback(
    async (url: string) => {
      try {
        const measured = await measureRemoteImage(url);
        const reference = await client.reference.importFromUrl.mutate({
          projectId,
          url,
          width: measured?.width,
          height: measured?.height,
        });
        return { referenceId: reference.id, width: reference.width, height: reference.height };
      } catch (error) {
        /// The reason crosses as the error's message; anything else — a dropped
        /// connection, a 500 — falls back to the generic line.
        setFailure(
          remoteImageFailureMessage(error instanceof TRPCClientError ? error.message : null),
        );
        return null;
      } finally {
        inFlight.current.delete(url);
      }
    },
    [client, projectId],
  );

  /// A list rather than one URL, for the same reason the sidebar drag carries a
  /// set: a copied page region can hold several images, and they land as the one
  /// grid `placeReferences` lays out rather than stacked on a single point. An
  /// import of one is the same code as an import of six.
  const importWebImages = useCallback(
    async (urls: readonly string[], at: ScenePoint) => {
      const wanted = urls.filter((url) => !inFlight.current.has(url));
      if (wanted.length === 0) return;
      for (const url of wanted) inFlight.current.add(url);
      setImporting((count) => count + wanted.length);

      try {
        /// The ones that landed are placed even when a sibling failed: five
        /// photos arriving is closer to what was asked for than nothing.
        const imported = (await Promise.all(wanted.map(importOne))).filter(
          (reference) => reference !== null,
        );
        if (imported.length === 0) return;

        /// Read now rather than captured: the fetch took seconds and the board
        /// may have been closed or switched underneath it.
        const api = editor.current;
        if (!api) return;
        placeReferences(api, imported, at);

        /// The images are project references now, so the sidebar strip and the
        /// gallery are both a list behind.
        void queryClient.invalidateQueries({
          queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
        });
      } finally {
        setImporting((count) => Math.max(0, count - wanted.length));
      }
    },
    [editor, importOne, projectId, queryClient, trpc],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);

  return { importWebImages, importing, importFailure: failure, dismissFailure };
}

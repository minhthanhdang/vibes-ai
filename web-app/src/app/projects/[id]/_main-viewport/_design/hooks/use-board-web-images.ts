"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { remoteImageFailureMessage } from "@/lib/intake/remote-image";
import { derivationDecidesPlacement, needsDerivedCopy } from "@/lib/intake/reference-derived";
import type { ScenePoint } from "@/lib/canvas/moodboard-drop";
import { placeReferences } from "../utils/board-references";
import { deriveReferenceCopies } from "../../../_reference/hooks/use-derived-reference-copies";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

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
  const inFlight = useRef(new Set<string>());

  const invalidateReferences = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
    });
  }, [projectId, queryClient, trpc]);

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

        const size = { width: reference.width, height: reference.height };
        if (needsDerivedCopy(reference)) {
          const derived = deriveReferenceCopies(client, projectId, reference)
            .then((result) => {
              if (result) invalidateReferences();
              return result;
            })
            .catch(() => null);

          if (derivationDecidesPlacement(reference)) {
            const result = await derived;
            if (result?.width && result.height) {
              size.width = result.width;
              size.height = result.height;
            }
          }
        }

        return { referenceId: reference.id, ...size };
      } catch (error) {
        setFailure(
          remoteImageFailureMessage(error instanceof TRPCClientError ? error.message : null),
        );
        return null;
      } finally {
        inFlight.current.delete(url);
      }
    },
    [client, invalidateReferences, projectId],
  );

  const importWebImages = useCallback(
    async (urls: readonly string[], at: ScenePoint) => {
      const wanted = urls.filter((url) => !inFlight.current.has(url));
      if (wanted.length === 0) return;
      for (const url of wanted) inFlight.current.add(url);
      setImporting((count) => count + wanted.length);

      try {
        const imported = (await Promise.all(wanted.map(importOne))).filter(
          (reference) => reference !== null,
        );
        if (imported.length === 0) return;

        const api = editor.current;
        if (!api) return;
        placeReferences(api, imported, at);
        invalidateReferences();
      } finally {
        setImporting((count) => Math.max(0, count - wanted.length));
      }
    },
    [editor, importOne, invalidateReferences],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);

  return { importWebImages, importing, importFailure: failure, dismissFailure };
}

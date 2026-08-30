"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { hashFileContent } from "@/lib/intake/content-hash";
import { croppablePhotos } from "@/lib/canvas/moodboard-crop";
import { BOARD_CROP_INTENT, cropBoxColumns, cropBoxOfRegion } from "@/lib/references/reference-version";
import { referenceFileId } from "@/lib/scene/moodboard-scene";
import { referenceCanvasImagePath } from "@/server/references/display";
import { cutFromOriginal } from "../../../_reference/utils/cut-reference";
import { uploadVersion } from "../../../_reference/utils/upload-reference";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

const CROP_CONCURRENCY = 3;

export function useBoardCrops({
  projectId,
  editor,
}: {
  projectId: string;
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const [keeping, setKeeping] = useState(0);
  const [failed, setFailed] = useState(0);
  const inFlight = useRef(new Set<string>());

  const keepCrops = useCallback(async () => {
    const api = editor.current;
    if (!api) return;

    const photos = croppablePhotos(api.getSceneElements(), api.getAppState()).filter(
      (photo) => !inFlight.current.has(photo.elementId),
    );
    if (photos.length === 0) return;

    for (const photo of photos) inFlight.current.add(photo.elementId);
    setKeeping((count) => count + photos.length);

    try {
      const results = await mapWithConcurrency(photos, CROP_CONCURRENCY, async (photo) => {
        try {
          const box = cropBoxOfRegion(photo.region);
          if (!box) return null;

          const cut = await cutFromOriginal(photo.referenceId, photo.region);
          if (!cut) return null;

          const reference = await uploadVersion(client, projectId, {
            file: cut.file,
            contentType: cut.contentType,
            contentHash: await hashFileContent(cut.file),
            sourceReferenceId: photo.referenceId,
            editIntent: BOARD_CROP_INTENT,
            cropBox: cropBoxColumns(box),
          });

          return {
            elementId: photo.elementId,
            sourceReferenceId: photo.referenceId,
            referenceId: reference.id,
            mimeType: cut.contentType,
          };
        } finally {
          inFlight.current.delete(photo.elementId);
        }
      });

      const kept = results
        .map((result) => (result.status === "fulfilled" ? result.value : null))
        .filter((entry) => entry !== null);
      const failures = results.length - kept.length;
      if (failures > 0) setFailed((count) => count + failures);
      if (kept.length === 0) return;

      const live = editor.current;
      if (!live) return;

      live.addFiles(
        kept.map((entry) => ({
          id: referenceFileId(entry.referenceId) as BinaryFileData["id"],
          dataURL: referenceCanvasImagePath(entry.referenceId) as BinaryFileData["dataURL"],
          mimeType: entry.mimeType,
          created: Date.now(),
        })),
      );

      const repointed = new Map(kept.map((entry) => [entry.elementId, entry.referenceId]));
      const elements = live.getSceneElementsIncludingDeleted().map((element) => {
        const referenceId = repointed.get(element.id);
        if (!referenceId || element.type !== "image") return element;
        return newElementWith(element, {
          fileId: referenceFileId(referenceId) as BinaryFileData["id"],
          crop: null,
          status: "saved",
        });
      });

      live.updateScene({
        elements: elements as unknown as ExcalidrawInitialDataState["elements"],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      for (const referenceId of new Set(kept.map((entry) => entry.sourceReferenceId))) {
        void queryClient.invalidateQueries({
          queryKey: trpc.reference.versions.queryOptions({ referenceId }).queryKey,
        });
      }
      void queryClient.invalidateQueries({
        queryKey: trpc.reference.versionLinksByProject.queryOptions({ projectId }).queryKey,
      });
    } finally {
      setKeeping((count) => Math.max(0, count - photos.length));
    }
  }, [client, editor, projectId, queryClient, trpc]);

  const dismissCropFailure = useCallback(() => setFailed(0), []);

  return { keepCrops, keeping, failedCrops: failed, dismissCropFailure };
}

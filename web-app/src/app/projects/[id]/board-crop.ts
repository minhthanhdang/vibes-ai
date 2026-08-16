"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { mapWithConcurrency } from "@/lib/concurrency";
import { hashFileContent } from "@/lib/content-hash";
import { croppablePhotos, croppedReferenceTitle } from "@/lib/moodboard-crop";
import { referenceFileId } from "@/lib/moodboard-scene";
import { referenceCanvasImagePath } from "@/server/references/display";
import { cutFromOriginal } from "./cut-reference";
import { uploadReference } from "./upload-reference";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

/// Turning a crop the director made on the board into a photo the project has.
///
/// Excalidraw's crop is a window onto the whole file, and it stays that way
/// forever: the gallery keeps showing the frame that was cut away, agent 2 keeps
/// reading a palette off it, and the board keeps loading the entire photograph to
/// draw a corner of it. Keeping the crop cuts it out for real — a `Reference` of
/// its own, analyzed like any other — and repoints the element at it, which
/// changes nothing on screen and everything behind it.
///
/// The cut itself is `cut-reference.ts` — the same one agent 3's crop is made
/// with, on the same original read back same-origin.

/// Matches the gallery's dropzone and adoption: enough to keep a handful of
/// crops moving without the tab fighting itself for decode and bandwidth.
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

  /// The same query the sidebar strip and the inspector render from, so the name
  /// the crop inherits costs nothing. A reference the list has not caught up with
  /// yet simply gives the crop the generic name, which is cosmetic.
  const { data: references } = useQuery(trpc.reference.listByProject.queryOptions({ projectId }));

  const [keeping, setKeeping] = useState(0);
  const [failed, setFailed] = useState(0);
  /// Elements whose crop is already being cut. A second press while the first
  /// upload is out would buy two copies of one crop and repoint the element at
  /// whichever landed last.
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

    const titles = new Map((references ?? []).map((reference) => [reference.id, reference.title]));

    try {
      const results = await mapWithConcurrency(photos, CROP_CONCURRENCY, async (photo) => {
        try {
          const cut = await cutFromOriginal(photo.referenceId, photo.region);
          /// A browser with no `OffscreenCanvas`, or a file it cannot decode.
          /// Counted rather than swallowed: the element still shows the crop, so
          /// nothing on screen would say it had not been kept.
          if (!cut) return null;

          const reference = await uploadReference(client, projectId, {
            file: cut.file,
            contentType: cut.contentType,
            /// The same digest every other upload path stores, so a crop saved
            /// twice is recognised as one the project already holds.
            contentHash: await hashFileContent(cut.file),
            title: croppedReferenceTitle(titles.get(photo.referenceId) ?? ""),
          });

          return {
            elementId: photo.elementId,
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

      /// Read again rather than reused: cutting and uploading took seconds, and
      /// the director has been arranging throughout.
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
        /// `newElementWith` rather than a spread: excalidraw redraws an element
        /// from a cache keyed on its `version`, so one whose file changed but
        /// whose version did not keeps drawing the photo it was showing before.
        return newElementWith(element, {
          fileId: referenceFileId(referenceId) as BinaryFileData["id"],
          /// The window is the file now. The element's own box is untouched, so
          /// nothing moves and nothing resizes — it is the same picture, drawn
          /// from a photo that is only that picture.
          crop: null,
          status: "saved",
        });
      });

      live.updateScene({
        elements: elements as unknown as ExcalidrawInitialDataState["elements"],
        /// An edit the director asked for, so it is theirs to undo — and undoing
        /// it puts the element back on the full frame it was cropping, which is
        /// still in the project.
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      /// The crops are references now, so the strip and the gallery are both a
      /// list behind.
      void queryClient.invalidateQueries({
        queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
      });
    } finally {
      setKeeping((count) => Math.max(0, count - photos.length));
    }
  }, [client, editor, projectId, queryClient, references, trpc]);

  const dismissCropFailure = useCallback(() => setFailed(0), []);

  return { keepCrops, keeping, failedCrops: failed, dismissCropFailure };
}

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

/// Turning a crop the user made on the board into a modified version of the
/// frame it was drawn on.
///
/// Excalidraw's crop is a window onto the whole file, and it stays that way
/// forever: the gallery keeps showing the frame that was cut away, agent 2 keeps
/// reading a palette off it, and the board keeps loading the entire photograph to
/// draw a corner of it. Keeping the crop cuts it out for real — a `Reference` of
/// its own, analyzed like any other — and repoints the element at it, which
/// changes nothing on screen and everything behind it.
///
/// It is filed as a *version* rather than as a photo of the project, which is the
/// same answer agent 3's crop gets: a crop is a reading of a frame, so it belongs
/// under that frame's properties beside the cropper's own cuts, and a gallery of
/// pieces of photographs is a gallery nobody can find a photograph in. Both crop
/// paths therefore end at one mutation, and the title and the box a version is
/// filed with follow from the source row rather than from whatever list this tab
/// happened to be holding.
///
/// The cut itself is `cut-reference.ts` — the same one the properties panel cuts
/// a kept plan with, on the same original read back same-origin. Agent 3's crop is
/// cut on the server now and shares the arithmetic rather than the canvas.

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

    try {
      const results = await mapWithConcurrency(photos, CROP_CONCURRENCY, async (photo) => {
        try {
          /// The window the element was drawing, in the numbers a version's row
          /// records — so a cut made by hand says what part of the frame it is
          /// exactly as the cropper's does.
          const box = cropBoxOfRegion(photo.region);
          if (!box) return null;

          const cut = await cutFromOriginal(photo.referenceId, photo.region);
          /// A browser with no `OffscreenCanvas`, or a file it cannot decode.
          /// Counted rather than swallowed: the element still shows the crop, so
          /// nothing on screen would say it had not been kept.
          if (!cut) return null;

          const reference = await uploadVersion(client, projectId, {
            file: cut.file,
            contentType: cut.contentType,
            /// The same digest every other upload path stores, so a crop saved
            /// twice is recognised as one the project already holds.
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

      /// Read again rather than reused: cutting and uploading took seconds, and
      /// the user has been arranging throughout.
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
        /// An edit the user asked for, so it is theirs to undo — and undoing
        /// it puts the element back on the full frame it was cropping, which is
        /// still in the project.
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      /// The gallery is unchanged — a cut is not a photograph of the project —
      /// but the frame it came out of has a version it did not have, and that
      /// list is open in the other column whenever the user cropped from it.
      for (const referenceId of new Set(kept.map((entry) => entry.sourceReferenceId))) {
        void queryClient.invalidateQueries({
          queryKey: trpc.reference.versions.queryOptions({ referenceId }).queryKey,
        });
      }
      /// And the grid's own count of those cuts, which is all the gallery says
      /// about a version it does not show.
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

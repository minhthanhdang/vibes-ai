"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { mapWithConcurrency } from "@/lib/concurrency";
import { hashFileContent } from "@/lib/content-hash";
import { IMAGE_EXTENSIONS } from "@/lib/image-types";
import {
  ADOPTED_IMAGE_TITLE,
  adoptableUpload,
  unadoptedImages,
  withAdoptedFileIds,
} from "@/lib/moodboard-images";
import { referenceFileId } from "@/lib/moodboard-scene";
import { referenceImagePath } from "@/server/references/display";
import { uploadReference } from "./upload-reference";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

/// Excalidraw can put an image on the board on its own — paste, a file dragged
/// from the desktop, its toolbar's image button — and holds the bytes in a map
/// the board row does not store. Left alone, those images render all session
/// and reload as empty boxes. Adoption is what closes that: the bytes become a
/// project `Reference` and the element is repointed at it, which is the one
/// shape of image the board's load knows how to resolve.
///
/// The scan is deliberately not on `onChange` — that fires per drag frame.
/// It runs on the same quiet period the autosave collects on, so a paste is
/// adopted about a second later and a drag costs nothing.

/// Matches the gallery's dropzone: enough to keep a multi-image paste moving
/// without the tab fighting itself for decode and upstream bandwidth.
const ADOPTION_CONCURRENCY = 3;

export function useBoardImageAdoption({
  projectId,
  editor,
}: {
  projectId: string;
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  /// Every file id already dealt with, successfully or not. Without it the next
  /// quiet period re-uploads an image whose row is still landing, and a paste
  /// that cannot be adopted at all would be retried forever.
  const attempted = useRef(new Set<string>());
  const [failed, setFailed] = useState(0);

  const adopt = useCallback(async () => {
    const api = editor.current;
    if (!api) return;

    const pending = unadoptedImages(api.getSceneElementsIncludingDeleted(), api.getFiles()).filter(
      (image) => !attempted.current.has(image.fileId),
    );
    if (!pending.length) return;
    for (const image of pending) attempted.current.add(image.fileId);

    const adopted = new Map<string, string>();
    const files: BinaryFileData[] = [];
    let failures = 0;

    await mapWithConcurrency(pending, ADOPTION_CONCURRENCY, async (image) => {
      const upload = adoptableUpload(image);
      /// A format the project cannot hold — an SVG, a HEIC. Counted rather than
      /// swallowed: the element stays on the board this session and will not
      /// come back, and that has to be said before the tab is closed.
      if (!upload) {
        failures += 1;
        return;
      }

      try {
        /// Named for the type rather than after the element: a pasted image has
        /// no filename, and the upload URL is signed for the content type.
        const file = new File([upload.bytes], `board.${IMAGE_EXTENSIONS[upload.contentType]}`, {
          type: upload.contentType,
        });
        const reference = await uploadReference(client, projectId, {
          file,
          contentType: upload.contentType,
          /// The same digest the gallery's dropzone stores, so an image pasted
          /// here and later dropped as a file is recognised as one the project
          /// already holds.
          contentHash: await hashFileContent(file),
          title: ADOPTED_IMAGE_TITLE,
        });

        adopted.set(image.fileId, reference.id);
        files.push({
          id: referenceFileId(reference.id) as BinaryFileData["id"],
          dataURL: referenceImagePath(reference.id) as BinaryFileData["dataURL"],
          mimeType: upload.contentType,
          created: Date.now(),
        });
      } catch {
        failures += 1;
      }
    });

    if (failures) setFailed((count) => count + failures);
    if (!adopted.size) return;

    /// Read again rather than reused: the uploads took seconds, and the
    /// director has been drawing throughout.
    const live = editor.current;
    if (!live) return;

    live.addFiles(files);
    live.updateScene({
      elements: withAdoptedFileIds(
        live.getSceneElementsIncludingDeleted(),
        adopted,
      ) as unknown as ExcalidrawInitialDataState["elements"],
      /// Not an edit the director made, so not a step for them to undo into —
      /// and undoing past it would restore elements naming bytes the board
      /// cannot reload.
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    /// The adopted images are references now, so the sidebar strip and the
    /// gallery are both a list behind.
    void queryClient.invalidateQueries({
      queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
    });
  }, [client, editor, projectId, queryClient, trpc]);

  /// The way out of a failure the director can act on — the network came back,
  /// or the analyzer queue was the thing that was down. Everything is offered
  /// again: an image already adopted no longer reads as unadopted, so a retry
  /// can only pick up what is still holding excalidraw's own bytes.
  const retryAdoption = useCallback(() => {
    attempted.current = new Set();
    setFailed(0);
    void adopt();
  }, [adopt]);

  return { adopt, failedAdoptions: failed, retryAdoption };
}

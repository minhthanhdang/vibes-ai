"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { hashFileContent } from "@/lib/intake/content-hash";
import { IMAGE_EXTENSIONS, isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";
import {
  ADOPTED_IMAGE_TITLE,
  REFERENCE_LOCATE_LIMIT,
  adoptableUpload,
  unadoptedImages,
  unresolvedReferenceIds,
  withAdoptedFileIds,
  type BoardImageFile,
} from "@/lib/canvas/moodboard-images";
import { referenceFileId } from "@/lib/scene/moodboard-scene";
import { referenceCanvasImagePath } from "@/server/references/display";
import { uploadReference } from "../../../_reference/utils/upload-reference";
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
/// The same scan also repairs the other way an image can be on the board with
/// nothing behind it: an element carrying a `ref:` pointer into a *different*
/// project. Copying an image element from one board and pasting it into another
/// is excalidraw's own gesture and it brings the file entry along, so it draws
/// perfectly — but the load resolves those pointers against the board's own
/// project, and across projects it resolves to nothing. Those are copied in:
/// the photo becomes a reference of *this* project and the element is repointed
/// at it, exactly as a pasted one is.
///
/// The scan is deliberately not on `onChange` — that fires per drag frame.
/// It runs on the same quiet period the autosave collects on, so a paste is
/// adopted about a second later and a drag costs nothing.

/// Matches the gallery's dropzone: enough to keep a multi-image paste moving
/// without the tab fighting itself for decode and upstream bandwidth.
const ADOPTION_CONCURRENCY = 3;

/// One image on its way into the project, whichever route it arrived by. The
/// `fileId` is what the element names now and what the repoint replaces; a
/// pasted image names excalidraw's content hash, a copied-in one a `ref:`
/// pointer this project cannot resolve.
type AdoptionSource =
  | { fileId: string; kind: "bytes"; image: BoardImageFile }
  | { fileId: string; kind: "reference"; referenceId: string; title: string };

export function useBoardImageAdoption({
  projectId,
  editor,
  knownReferenceIds,
}: {
  projectId: string;
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
  /// The references the server resolved when it built this board's file map, so
  /// a board full of its own photos asks nothing. Everything else — a drop from
  /// the strip, an import, a paste — is looked up once and remembered.
  knownReferenceIds: readonly string[];
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  /// Every file id already dealt with, successfully or not. Without it the next
  /// quiet period re-uploads an image whose row is still landing, and a paste
  /// that cannot be adopted at all would be retried forever.
  const attempted = useRef(new Set<string>());
  /// References confirmed to be this project's. Confirmation is the server's
  /// rather than the reference list's: a photo dropped or imported seconds ago
  /// is in the project before any cached list says so, and reading a stale list
  /// as the truth would copy a reference the board already had.
  const holds = useRef(new Set(knownReferenceIds));
  const [failed, setFailed] = useState(0);

  /// Which of the board's unrecognised pointers are the user's own photos in
  /// another project — the ones a copy can be made of. The rest are references
  /// that have been deleted, or were never theirs, and there is nothing left to
  /// fetch: they stay the placeholder the gallery's own delete already accounted
  /// for rather than becoming a warning about a photo that no longer exists.
  const locate = useCallback(
    async (ids: string[]) => {
      const located = await client.reference.locateForProject.query({ projectId, ids });
      for (const id of located.inProject) holds.current.add(id);
      return located.elsewhere;
    },
    [client, projectId],
  );

  const adopt = useCallback(async () => {
    const api = editor.current;
    if (!api) return;

    const elements = api.getSceneElementsIncludingDeleted();
    const pending = unadoptedImages(elements, api.getFiles()).filter(
      (image) => !attempted.current.has(image.fileId),
    );
    const unresolved = unresolvedReferenceIds(elements, holds.current)
      .filter((referenceId) => !attempted.current.has(referenceFileId(referenceId)))
      /// Asked in batches the lookup will accept: one refused for being too long
      /// answers nothing, and the rest of the board would wait behind it.
      .slice(0, REFERENCE_LOCATE_LIMIT);
    if (!pending.length && !unresolved.length) return;

    /// Claimed before anything is awaited. The scan runs on a timer and a lookup
    /// or an upload can outlast the next quiet period, so an id claimed twice is
    /// a photo uploaded twice and an element repointed at the second copy.
    for (const image of pending) attempted.current.add(image.fileId);
    for (const referenceId of unresolved) attempted.current.add(referenceFileId(referenceId));

    const sources: AdoptionSource[] = pending.map((image) => ({
      fileId: image.fileId,
      kind: "bytes",
      image,
    }));
    if (unresolved.length) {
      try {
        for (const { id, title } of await locate(unresolved)) {
          sources.push({ fileId: referenceFileId(id), kind: "reference", referenceId: id, title });
        }
      } catch {
        /// A lookup that did not answer says nothing about those pointers, so
        /// the claim is given back and the next quiet period asks again rather
        /// than copying a photo in on a guess.
        for (const referenceId of unresolved) attempted.current.delete(referenceFileId(referenceId));
      }
    }

    if (!sources.length) return;

    const adopted = new Map<string, string>();
    const files: BinaryFileData[] = [];
    let failures = 0;

    await mapWithConcurrency(sources, ADOPTION_CONCURRENCY, async (source) => {
      try {
        const upload = await uploadableImage(source);
        /// A format the project cannot hold — an SVG, a HEIC. Counted rather
        /// than swallowed: the element stays on the board this session and will
        /// not come back, and that has to be said before the tab is closed.
        if (!upload) {
          failures += 1;
          return;
        }

        const reference = await uploadReference(client, projectId, {
          file: upload.file,
          contentType: upload.contentType,
          /// The same digest the gallery's dropzone stores, so an image pasted
          /// here and later dropped as a file is recognised as one the project
          /// already holds.
          contentHash: await hashFileContent(upload.file),
          title: upload.title,
        });

        holds.current.add(reference.id);
        adopted.set(source.fileId, reference.id);
        files.push({
          id: referenceFileId(reference.id) as BinaryFileData["id"],
          /// The streaming path, matching the load: the adopted image has to be
          /// as exportable now as it will be after a reload.
          dataURL: referenceCanvasImagePath(reference.id) as BinaryFileData["dataURL"],
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
    /// user has been drawing throughout.
    const live = editor.current;
    if (!live) return;

    live.addFiles(files);
    live.updateScene({
      elements: withAdoptedFileIds(
        live.getSceneElementsIncludingDeleted(),
        adopted,
      ) as unknown as ExcalidrawInitialDataState["elements"],
      /// Not an edit the user made, so not a step for them to undo into —
      /// and undoing past it would restore elements naming bytes the board
      /// cannot reload.
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    /// The adopted images are references now, so the sidebar strip and the
    /// gallery are both a list behind.
    void queryClient.invalidateQueries({
      queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
    });
  }, [client, editor, locate, projectId, queryClient, trpc]);

  /// The way out of a failure the user can act on — the network came back,
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

/// The file one adoption sends, or null when the project cannot hold it.
///
/// A pasted image already carries its bytes in the scene. A reference copied in
/// from another project carries only a pointer, so the bytes are read back
/// through this app's own image route — the *original*, not whatever copy the
/// board it was copied from happened to be drawing, since what lands in the
/// project is the photo and not a thumbnail of it. Same-origin by construction,
/// which is the property that made the board's export work in the first place.
async function uploadableImage(
  source: AdoptionSource,
): Promise<{ file: File; contentType: UploadContentType; title: string } | null> {
  if (source.kind === "bytes") {
    const upload = adoptableUpload(source.image);
    if (!upload) return null;
    return {
      /// Named for the type rather than after the element: a pasted image has no
      /// filename, and the upload URL is signed for the content type.
      file: new File([upload.bytes], `board.${IMAGE_EXTENSIONS[upload.contentType]}`, {
        type: upload.contentType,
      }),
      contentType: upload.contentType,
      title: ADOPTED_IMAGE_TITLE,
    };
  }

  const response = await fetch(referenceCanvasImagePath(source.referenceId));
  if (!response.ok) throw new Error(`read failed (${response.status})`);

  const blob = await response.blob();
  const contentType = blob.type.toLowerCase();
  if (!isUploadContentType(contentType)) return null;

  return {
    file: new File([blob], `board.${IMAGE_EXTENSIONS[contentType]}`, { type: contentType }),
    contentType,
    /// The photo keeps the name it was given in the project it came from — a
    /// copy that arrives called "Board image" is one the user has to
    /// recognise all over again.
    title: source.title || ADOPTED_IMAGE_TITLE,
  };
}

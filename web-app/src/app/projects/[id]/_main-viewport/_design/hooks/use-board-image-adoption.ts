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

const ADOPTION_CONCURRENCY = 3;

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
  knownReferenceIds: readonly string[];
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const attempted = useRef(new Set<string>());
  const holds = useRef(new Set(knownReferenceIds));
  const [failed, setFailed] = useState(0);

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
      .slice(0, REFERENCE_LOCATE_LIMIT);
    if (!pending.length && !unresolved.length) return;

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
        if (!upload) {
          failures += 1;
          return;
        }

        const reference = await uploadReference(client, projectId, {
          file: upload.file,
          contentType: upload.contentType,
          contentHash: await hashFileContent(upload.file),
          title: upload.title,
        });

        holds.current.add(reference.id);
        adopted.set(source.fileId, reference.id);
        files.push({
          id: referenceFileId(reference.id) as BinaryFileData["id"],
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

    const live = editor.current;
    if (!live) return;

    live.addFiles(files);
    live.updateScene({
      elements: withAdoptedFileIds(
        live.getSceneElementsIncludingDeleted(),
        adopted,
      ) as unknown as ExcalidrawInitialDataState["elements"],
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    void queryClient.invalidateQueries({
      queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
    });
  }, [client, editor, locate, projectId, queryClient, trpc]);

  const retryAdoption = useCallback(() => {
    attempted.current = new Set();
    setFailed(0);
    void adopt();
  }, [adopt]);

  return { adopt, failedAdoptions: failed, retryAdoption };
}

async function uploadableImage(
  source: AdoptionSource,
): Promise<{ file: File; contentType: UploadContentType; title: string } | null> {
  if (source.kind === "bytes") {
    const upload = adoptableUpload(source.image);
    if (!upload) return null;
    return {
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
    title: source.title || ADOPTED_IMAGE_TITLE,
  };
}

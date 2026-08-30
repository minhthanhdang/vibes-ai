"use client";

import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { droppedImages, type ReferenceDragItem, type ScenePoint } from "@/lib/canvas/moodboard-drop";
import { boardFrames } from "@/lib/canvas/moodboard-frames";
import { boardPages, frameJoining, pageChildOrder } from "@/lib/pages/board-pages";
import { referenceFileId } from "@/lib/scene/moodboard-scene";
import { boardImageVariant } from "@/lib/scene/moodboard-resolution";
import { referenceCanvasImagePath } from "@/server/references/display";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

export function placeReferences(
  api: ExcalidrawImperativeAPI,
  references: readonly ReferenceDragItem[],
  at: ScenePoint,
) {
  const images = droppedImages(references, at);
  if (images.length === 0) return;

  api.addFiles(
    references.map((reference, index) => ({
      id: referenceFileId(reference.referenceId) as BinaryFileData["id"],
      dataURL: referenceCanvasImagePath(
        reference.referenceId,
        boardImageVariant(images[index]!) === "thumb" ? "thumb" : undefined,
      ) as BinaryFileData["dataURL"],
      mimeType: "image/jpeg",
      created: Date.now(),
    })),
  );

  const scene = api.getSceneElements();
  const frames = boardFrames(scene);
  const pages = boardPages(scene);

  const elements = convertToExcalidrawElements(
    images.map((image) => ({
      ...image,
      fileId: image.fileId as BinaryFileData["id"],
      frameId: frameJoining(frames, pages, image),
    })),
  );
  if (elements.length === 0) return;

  const joinedPage = elements.some(
    (element) => element.frameId && pages.some((page) => page.id === element.frameId),
  );
  const scenery = [...api.getSceneElementsIncludingDeleted(), ...elements];

  api.updateScene({
    elements: (joinedPage
      ? pageChildOrder(scenery)
      : scenery) as unknown as ExcalidrawInitialDataState["elements"],
    appState: {
      selectedElementIds: Object.fromEntries(elements.map((element) => [element.id, true])),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

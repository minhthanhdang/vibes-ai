"use client";

import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { droppedImages, type ReferenceDragItem, type ScenePoint } from "@/lib/moodboard-drop";
import { referenceFileId } from "@/lib/moodboard-scene";
import { referenceCanvasImagePath } from "@/server/references/display";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

/// Putting references on the board, wherever they came from — the sidebar drag
/// and an image imported from a web page land the same way, because once a photo
/// is a `Reference` there is only one kind of image element the board has.

export function placeReferences(
  api: ExcalidrawImperativeAPI,
  references: readonly ReferenceDragItem[],
  at: ScenePoint,
) {
  const images = droppedImages(references, at);
  if (images.length === 0) return;

  /// The bytes are never in the scene — this is the same app URL a reload would
  /// hydrate, so the dropped image and the reloaded one are one cache entry. The
  /// mime type is a placeholder the editor only needs to decide it is not an
  /// SVG; the load derives the real one from the row.
  api.addFiles(
    references.map((reference) => ({
      /// `fileId` is branded in excalidraw's types purely to stop the two id
      /// spaces being confused; ours is a `ref:` pointer by construction.
      id: referenceFileId(reference.referenceId) as BinaryFileData["id"],
      dataURL: referenceCanvasImagePath(reference.referenceId) as BinaryFileData["dataURL"],
      mimeType: "image/jpeg",
      created: Date.now(),
    })),
  );

  /// `convertToExcalidrawElements` fills in everything an element needs that is
  /// excalidraw's business — id, seed, version, fractional index — so the caller
  /// only has to say which reference, where and how big.
  const elements = convertToExcalidrawElements(
    images.map((image) => ({ ...image, fileId: image.fileId as BinaryFileData["id"] })),
  );
  if (elements.length === 0) return;

  api.updateScene({
    /// Including the deleted ones: they are the tombstones undo restores from,
    /// and handing back a scene without them would quietly make every earlier
    /// deletion permanent.
    elements: [
      ...api.getSceneElementsIncludingDeleted(),
      ...elements,
    ] as unknown as ExcalidrawInitialDataState["elements"],
    /// Selected on arrival: the next thing the director does is place it, and an
    /// unselected drop costs a click before it can be moved or scaled. A batch
    /// arrives selected as a batch, so it can be moved as the block it was
    /// dropped as.
    appState: {
      selectedElementIds: Object.fromEntries(elements.map((element) => [element.id, true])),
    },
    /// Undoable like any other edit — a drop is a mistake as often as a stroke
    /// is, and a batch undoes in one step because it landed in one.
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

"use client";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { arrangeChanges, arrangeTargets } from "@/lib/moodboard-arrange";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

/// Tidying the board. The layout is decided by a module that has never heard of
/// a canvas; this is only the part that reads the editor's scene and writes the
/// new geometry back onto the same elements — so a tidy is an ordinary edit the
/// autosave stores and one ⌘Z undoes, not a mode or a re-creation of the board.

export function tidyBoard(api: ExcalidrawImperativeAPI) {
  const { boxes } = arrangeTargets(api.getSceneElements(), api.getAppState());
  const moved = new Map(arrangeChanges(boxes).map((box) => [box.id, box]));
  if (moved.size === 0) return;

  /// Tombstones are carried through untouched, as every other programmatic
  /// update on this board does: dropping them would leave undo with nothing to
  /// restore for anything deleted before the tidy.
  ///
  /// `newElementWith` rather than a spread, because excalidraw caches a rendered
  /// element by its version — an element whose width changed but whose version
  /// did not is redrawn from the cache at its old size.
  const elements = api.getSceneElementsIncludingDeleted().map((element) => {
    const box = moved.get(element.id);
    /// x/y are the unrotated top-left, and excalidraw rotates about the centre,
    /// so a rotated photo lands centred in its cell with its angle intact.
    return box
      ? newElementWith(element, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        })
      : element;
  });

  api.updateScene({
    elements: elements as unknown as ExcalidrawInitialDataState["elements"],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

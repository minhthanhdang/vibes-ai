"use client";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import {
  arrangeTargets,
  elementPlacements,
  groupChanges,
  type ArrangeOrdering,
} from "@/lib/canvas/moodboard-arrange";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

/// Tidying the board. The layout is decided by a module that has never heard of
/// a canvas; this is only the part that reads the editor's scene and writes the
/// new geometry back onto the same elements — so a tidy is an ordinary edit the
/// autosave stores and one ⌘Z undoes, not a mode or a re-creation of the board.

/// `order` is what the grid is filled in. Left out it is the order the board
/// already reads in; the colour sort passes its own, and this module stays
/// unaware that a photo has a palette.
export function tidyBoard(api: ExcalidrawImperativeAPI, order?: ArrangeOrdering) {
  /// Frames are the board's sections and its pages, so the photos in one are laid
  /// out inside it and only what is on neither is laid out on its own bounds.
  /// A tidy that swept a frame's photos into the board's grid would leave them
  /// still belonging to a frame they are no longer in — drawn clipped at its
  /// edge, and dragged along the next time the frame is moved.
  const { groups } = arrangeTargets(api.getSceneElements(), api.getAppState());
  /// A unit is a photo *or* the group it is in, so what the layout hands back has
  /// to be turned into elements before it can be written: a captioned photo is
  /// one box to the grid and two elements to the scene.
  const units = groups.flatMap((group) => group.boxes);
  const placements = new Map(
    elementPlacements(units, groupChanges(groups, order)).map((placement) => [
      placement.id,
      placement,
    ]),
  );
  if (placements.size === 0) return;

  /// Tombstones are carried through untouched, as every other programmatic
  /// update on this board does: dropping them would leave undo with nothing to
  /// restore for anything deleted before the tidy.
  ///
  /// `newElementWith` rather than a spread, because excalidraw caches a rendered
  /// element by its version — an element whose width changed but whose version
  /// did not is redrawn from the cache at its old size.
  const elements = api.getSceneElementsIncludingDeleted().map((element) => {
    const placement = placements.get(element.id);
    if (!placement) return element;

    /// x/y are the unrotated top-left, and excalidraw rotates about the centre,
    /// so a rotated photo lands centred in its cell with its angle intact.
    const update: Record<string, unknown> = {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    };
    if (placement.fontSize !== undefined) update.fontSize = placement.fontSize;
    if (placement.points) update.points = placement.points;

    return newElementWith(element, update as Parameters<typeof newElementWith>[1]);
  });

  api.updateScene({
    elements: elements as unknown as ExcalidrawInitialDataState["elements"],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

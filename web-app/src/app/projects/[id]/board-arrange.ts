"use client";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import {
  arrangeTargets,
  elementPlacements,
  groupChanges,
  type ArrangeOrdering,
} from "@/lib/canvas/moodboard-arrange";
import { pageChildOrder } from "@/lib/pages/board-pages";
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
  /// edge, and dragged along the next time the frame is moved. Which is also why
  /// the press writes ownership beside geometry: a page holds what is
  /// geometrically on it (§V.3), and after the layout has decided that, the
  /// `frameId` excalidraw drags and clips by has to say the same thing.
  const { groups, owners } = arrangeTargets(api.getSceneElements(), api.getAppState());
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
  /// A photo already lying where the layout would put it can still be changing
  /// hands — the hand-made spread whose pictures are on a page and owned by
  /// nothing is exactly that board — so the ownership is its own reason to write.
  const owned = new Map(owners.map((owner) => [owner.id, owner.frameId]));
  if (placements.size === 0 && owned.size === 0) return;

  /// Tombstones are carried through untouched, as every other programmatic
  /// update on this board does: dropping them would leave undo with nothing to
  /// restore for anything deleted before the tidy.
  ///
  /// `newElementWith` rather than a spread, because excalidraw caches a rendered
  /// element by its version — an element whose width changed but whose version
  /// did not is redrawn from the cache at its old size.
  const elements = api.getSceneElementsIncludingDeleted().map((element) => {
    const placement = placements.get(element.id);
    if (!placement && !owned.has(element.id)) return element;

    /// x/y are the unrotated top-left, and excalidraw rotates about the centre,
    /// so a rotated photo lands centred in its cell with its angle intact.
    const update: Record<string, unknown> = placement
      ? {
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        }
      : {};
    if (placement?.fontSize !== undefined) update.fontSize = placement.fontSize;
    if (placement?.points) update.points = placement.points;
    /// The page the photo was laid out on takes it, in the same edit and so under
    /// the same ⌘Z: a board where the geometry and the ownership were written by
    /// two different presses is one where undoing the tidy leaves the pictures
    /// belonging to a page they are no longer arranged on.
    if (owned.has(element.id)) update.frameId = owned.get(element.id) ?? null;

    return newElementWith(element, update as Parameters<typeof newElementWith>[1]);
  });

  api.updateScene({
    /// Only when something changed hands: a page's children have to sit
    /// immediately before it, and gathering them is a z-order change no press
    /// that adopted nothing has any business making.
    elements: (owned.size > 0
      ? pageChildOrder(elements)
      : elements) as unknown as ExcalidrawInitialDataState["elements"],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

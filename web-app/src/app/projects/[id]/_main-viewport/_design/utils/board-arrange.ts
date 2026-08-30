"use client";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import {
  arrangeTargets,
  elementPlacements,
  groupChanges,
  type ArrangeOrdering,
} from "@/lib/canvas/moodboard-arrange";
import { pageChildOrder } from "@/lib/pages/board-pages";
import { renderFontOf } from "@/lib/render/render-plan";
import { flooredType } from "@/lib/render/text-set";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

export function tidyBoard(api: ExcalidrawImperativeAPI, order?: ArrangeOrdering) {
  const { groups, owners } = arrangeTargets(api.getSceneElements(), api.getAppState());
  const units = groups.flatMap((group) => group.boxes);
  const placements = new Map(
    elementPlacements(units, groupChanges(groups, order)).map((placement) => [
      placement.id,
      placement,
    ]),
  );
  const owned = new Map(owners.map((owner) => [owner.id, owner.frameId]));
  if (placements.size === 0 && owned.size === 0) return;

  const elements = api.getSceneElementsIncludingDeleted().map((element) => {
    const placement = placements.get(element.id);
    if (!placement && !owned.has(element.id)) return element;

    const update: Record<string, unknown> = placement
      ? {
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        }
      : {};
    if (placement?.fontSize !== undefined) {
      update.fontSize = placement.fontSize;
      const floored = flooredType(
        element,
        placement,
        renderFontOf(element).set,
      );
      if (floored) {
        update.fontSize = floored.fontSize;
        update.height = floored.height;
        if (floored.text) update.text = floored.text;
      }
    }
    if (placement?.points) update.points = placement.points;
    if (owned.has(element.id)) update.frameId = owned.get(element.id) ?? null;

    return newElementWith(element, update as Parameters<typeof newElementWith>[1]);
  });

  api.updateScene({
    elements: (owned.size > 0
      ? pageChildOrder(elements)
      : elements) as unknown as ExcalidrawInitialDataState["elements"],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

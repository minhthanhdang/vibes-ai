"use client";

import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import { scenePointOfViewportCentre } from "@/lib/canvas/moodboard-drop";
import { paletteAnchor, paletteSwatches } from "@/lib/canvas/moodboard-palette";
import { selectedElementIds } from "@/lib/canvas/moodboard-selection";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

export function placePalette(api: ExcalidrawImperativeAPI, colors: readonly string[]) {
  const state = api.getAppState();
  const scene = api.getSceneElements();

  const selected = new Set(selectedElementIds(state));
  const under = scene.filter((element) => selected.has(element.id));
  const at = under.length
    ? paletteAnchor(getCommonBounds(under))
    : scenePointOfViewportCentre({
        offsetLeft: state.offsetLeft,
        offsetTop: state.offsetTop,
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        zoom: state.zoom.value,
        width: state.width,
        height: state.height,
      });

  const groupId = crypto.randomUUID();
  const swatches = paletteSwatches(colors, at, groupId);
  if (swatches.length === 0) return;

  const elements = convertToExcalidrawElements(
    swatches as NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>,
  );
  if (elements.length === 0) return;

  const containers = elements.filter((element) => !("containerId" in element && element.containerId));

  api.updateScene({
    elements: [
      ...api.getSceneElementsIncludingDeleted(),
      ...elements,
    ] as unknown as ExcalidrawInitialDataState["elements"],
    appState: {
      selectedElementIds: Object.fromEntries(containers.map((element) => [element.id, true])),
      selectedGroupIds: { [groupId]: true },
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

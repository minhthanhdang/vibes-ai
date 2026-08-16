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

/// Putting a palette on the board. The colours are agent 2's; everything from
/// here down is excalidraw's own element machinery, exactly as a dropped
/// reference is — so a palette is as movable, scalable, groupable and undoable
/// as anything else on the canvas rather than a widget drawn over it.

export function placePalette(api: ExcalidrawImperativeAPI, colors: readonly string[]) {
  const state = api.getAppState();
  const scene = api.getSceneElements();

  /// Under the photos it is the palette of, when there are any. The selection
  /// is what the director asked about, so the bar belongs beneath it — and a
  /// palette added with nothing selected still has to land somewhere on screen.
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

  /// The id only has to be unique among this scene's groups; excalidraw's own
  /// are nanoids, and nothing reads them.
  const groupId = crypto.randomUUID();
  const swatches = paletteSwatches(colors, at, groupId);
  if (swatches.length === 0) return;

  /// The skeleton is built by a module that does not import excalidraw, so the
  /// literal types it declares are named here rather than there.
  const elements = convertToExcalidrawElements(
    swatches as NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>,
  );
  if (elements.length === 0) return;

  /// A labelled chip comes back as two elements — the rectangle and the text
  /// bound to it. Only the containers are selectable, and selecting a bound
  /// text is a state excalidraw does not expect from the outside.
  const containers = elements.filter((element) => !("containerId" in element && element.containerId));

  api.updateScene({
    elements: [
      ...api.getSceneElementsIncludingDeleted(),
      ...elements,
    ] as unknown as ExcalidrawInitialDataState["elements"],
    appState: {
      selectedElementIds: Object.fromEntries(containers.map((element) => [element.id, true])),
      /// Selected *as the group it is*: the palette arrived as one object and
      /// the next thing done with it is moving it somewhere, so the first drag
      /// must not pull a single colour out of the bar.
      selectedGroupIds: { [groupId]: true },
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

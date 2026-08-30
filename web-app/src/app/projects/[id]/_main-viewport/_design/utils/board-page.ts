"use client";

import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import { selectedElementIds } from "@/lib/canvas/moodboard-selection";
import { addPage } from "@/lib/pages/page-add";
import { framesToPromote, pageTargets } from "@/lib/pages/page-mark";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

export function addBoardPage(
  api: ExcalidrawImperativeAPI,
  defaultSize: { width: number; height: number },
) {
  const scene = api.getSceneElementsIncludingDeleted();
  const read = scene as unknown as SceneElement[];
  const { sourcePageId } = pageTargets(read, selectedElementIds(api.getAppState()));

  const added = addPage({ elements: read, defaultSize, sourcePageId });

  const skeleton = [added.elements.find((element) => element.id === added.page.id)];
  const [frame] = restoreElements(skeleton as unknown as Parameters<typeof restoreElements>[0], null);
  if (!frame) return null;

  const held = new Map(scene.map((element) => [element.id, element]));
  const adopted = new Set(added.adoptedIds);
  const elements = added.elements.map((element) => {
    if (element.id === added.page.id) return frame;
    const own = held.get(element.id)!;
    return adopted.has(element.id) ? newElementWith(own, { frameId: added.page.id }) : own;
  });

  api.updateScene({
    elements: elements as unknown as ExcalidrawInitialDataState["elements"],
    appState: { selectedElementIds: { [added.page.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(frame, { fitToViewport: true, animate: true });

  return added.page;
}

export function markSelectionAsPages(api: ExcalidrawImperativeAPI) {
  const scene = api.getSceneElementsIncludingDeleted();
  const promotions = framesToPromote(
    scene as unknown as SceneElement[],
    selectedElementIds(api.getAppState()),
  );

  if (promotions.length === 0) return 0;

  const byId = new Map(promotions.map((promotion) => [promotion.id, promotion]));
  const elements = scene.map((element) => {
    const promotion = byId.get(element.id);
    if (!promotion) return element;
    return newElementWith(element, {
      name: promotion.name,
      customData: promotion.customData,
    } as Parameters<typeof newElementWith>[1]);
  });

  api.updateScene({
    elements: elements as unknown as ExcalidrawInitialDataState["elements"],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return promotions.length;
}

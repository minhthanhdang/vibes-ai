"use client";

import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import {
  captionCentre,
  captionPlacement,
  captionText,
} from "@/lib/canvas/moodboard-caption";
import { selectedElementIds } from "@/lib/canvas/moodboard-selection";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

export function captionSelectedPhotos(api: ExcalidrawImperativeAPI, text: string): number {
  const caption = captionText(text);
  if (!caption) return 0;

  const state = api.getAppState();
  const selected = new Set(selectedElementIds(state));
  const photos = api
    .getSceneElements()
    .filter(
      (element) =>
        element.type === "image" &&
        selected.has(element.id) &&
        !element.locked &&
        element.groupIds.length === 0,
    );
  if (photos.length === 0) return 0;

  const added: ReturnType<typeof convertToExcalidrawElements> = [];
  const regrouped = new Map<string, string>();

  for (const photo of photos) {
    const groupId = crypto.randomUUID();
    const { x, y, fontSize } = captionPlacement(photo);

    const [element] = convertToExcalidrawElements([
      {
        type: "text",
        x,
        y,
        text: caption,
        fontSize,
        strokeColor: state.currentItemStrokeColor,
        fontFamily: state.currentItemFontFamily,
        groupIds: [groupId],
      },
    ] as NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>);
    if (!element) continue;

    added.push(newElementWith(element, { x: captionCentre(photo, element.width) }));
    regrouped.set(photo.id, groupId);
  }
  if (added.length === 0) return 0;

  const elements = api.getSceneElementsIncludingDeleted().map((element) => {
    const groupId = regrouped.get(element.id);
    return groupId ? newElementWith(element, { groupIds: [groupId] }) : element;
  });

  api.updateScene({
    elements: [...elements, ...added] as unknown as ExcalidrawInitialDataState["elements"],
    appState: {
      selectedElementIds: Object.fromEntries(
        [...regrouped.keys(), ...added.map((element) => element.id)].map((id) => [id, true]),
      ),
      selectedGroupIds: Object.fromEntries(
        [...regrouped.values()].map((groupId) => [groupId, true]),
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return added.length;
}

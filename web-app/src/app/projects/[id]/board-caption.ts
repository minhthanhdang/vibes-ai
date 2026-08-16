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

/// Captioning the selected photos. The text is an ordinary excalidraw text
/// element and the link to the photo is an ordinary excalidraw group — nothing
/// here is a widget drawn over the canvas, so the caption is restylable,
/// re-typeable, ungroupable and undoable from the moment it exists, and the
/// board's tidy carries it with its photo because a group is one unit.

/// Captions the selected image elements with `text`, one caption each.
///
/// A photo that is already in a group is skipped: excalidraw's groups nest, and
/// adding an outer group holding only this photo and its new caption — while its
/// existing group holds elements that are not in the outer one — is a state its
/// own gestures cannot produce. A photo that already has a caption does not need
/// a second one, and one grouped with something else has an arrangement the
/// director made that this must not rewrite.
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
    /// Unique among this scene's groups is all a group id has to be;
    /// excalidraw's own are nanoids and nothing reads them.
    const groupId = crypto.randomUUID();
    const { x, y, fontSize } = captionPlacement(photo);

    const [element] = convertToExcalidrawElements([
      {
        type: "text",
        x,
        y,
        text: caption,
        fontSize,
        /// The board's current ink, so a caption on a dark canvas is not the one
        /// black element on it.
        strokeColor: state.currentItemStrokeColor,
        fontFamily: state.currentItemFontFamily,
        groupIds: [groupId],
      },
    ] as NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>);
    if (!element) continue;

    /// Centred under the photo, which needs the width the editor measured — a
    /// module with no canvas in it cannot know how wide a string is set.
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
      /// Selected as the groups they now are: the next thing done with a
      /// captioned photo is moving it, and the first drag must not pull the
      /// photo out from under the caption that was just attached to it.
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

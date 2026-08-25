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

/// Making a page on the canvas. Where it goes, what it adopts and what it is
/// called are decided by modules that have never heard of a canvas (§V.1–2);
/// this is only the part that reads the editor's scene and writes the frame
/// back onto it — so a page arrives as an ordinary edit the autosave stores and
/// one ⌘Z undoes, exactly as a tidy or a palette does.
///
/// It is the same `addPage` the agent's own `add_page` tool calls, so a page the
/// user draws and a page the model adds are the same rectangle made the same
/// way, and neither can drift from what a page read describes.

export function addBoardPage(
  api: ExcalidrawImperativeAPI,
  defaultSize: { width: number; height: number },
) {
  /// Tombstones included, as every other programmatic update on this board does:
  /// dropping them would leave undo with nothing to restore for anything deleted
  /// before the page was added. `addPage` knows not to adopt them.
  const scene = api.getSceneElementsIncludingDeleted();
  const read = scene as unknown as SceneElement[];
  /// The page a new one is measured from is the selected one, if the user
  /// has one selected — "another one of these" is what asking with a page
  /// selected means.
  const { sourcePageId } = pageTargets(read, selectedElementIds(api.getAppState()));

  const added = addPage({ elements: read, defaultSize, sourcePageId });

  /// The frame skeleton is the same minimal one the server writes — geometry,
  /// name and the marker — and `restore` is what fills the seed, version and
  /// index, exactly as it does for the scene this board is opened with.
  ///
  /// `restore` rather than `convertToExcalidrawElements`: that one recomputes a
  /// frame's rectangle from the children named in the skeleton, and reads a page
  /// at the scene origin — `x: 0` — as no position at all, which puts a
  /// hand-made board's first page at infinity.
  const skeleton = [added.elements.find((element) => element.id === added.page.id)];
  const [frame] = restoreElements(skeleton as unknown as Parameters<typeof restoreElements>[0], null);
  if (!frame) return null;

  /// `addPage` returns a scene of plain objects; the editor is holding real
  /// elements and has to keep holding them — an element replaced by a copy of
  /// itself is redrawn from scratch and loses whatever excalidraw was caching
  /// against it. So only the order is taken from the answer, and the one change
  /// it makes to an existing element is written with `newElementWith`, which
  /// bumps the version the render cache is keyed on.
  const held = new Map(scene.map((element) => [element.id, element]));
  const adopted = new Set(added.adoptedIds);
  const elements = added.elements.map((element) => {
    if (element.id === added.page.id) return frame;
    const own = held.get(element.id)!;
    return adopted.has(element.id) ? newElementWith(own, { frameId: added.page.id }) : own;
  });

  api.updateScene({
    elements: elements as unknown as ExcalidrawInitialDataState["elements"],
    /// Selected, because a page added to a spread lands off the right-hand edge
    /// of everything the user can see — selecting it is what makes the scroll
    /// below land on the thing they asked for rather than on empty canvas.
    appState: { selectedElementIds: { [added.page.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(frame, { fitToViewport: true, animate: true });

  return added.page;
}

/// A frame the user drew, promoted to a page in place (§V.1). Nothing moves
/// and nothing is resized: the section becomes a page at the size and position it
/// already had, which is what makes a board that was divided up before pages
/// existed readable a page at a time without being rebuilt.
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

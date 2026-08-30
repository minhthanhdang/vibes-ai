"use client";

import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import { boardPages, pageById } from "@/lib/pages/board-pages";
import { PAGE_BACKGROUND_NONE, setPageBackground } from "@/lib/pages/page-background";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

export function paintBoardPage(
  api: ExcalidrawImperativeAPI,
  pageId: string,
  colour: string | null,
  { preview = false }: { preview?: boolean } = {},
) {
  const scene = api.getSceneElementsIncludingDeleted();
  const read = scene as unknown as SceneElement[];

  const page = pageById(boardPages(read), pageId);
  if (!page) return null;

  const edit = setPageBackground({
    elements: read,
    page,
    colour: colour ?? PAGE_BACKGROUND_NONE,
  });
  if (!edit || !edit.elements) return edit?.colour ?? null;

  const after = new Map(edit.elements.map((element) => [element.id, element]));
  const elements: unknown[] = scene.map((own) => {
    const now = after.get(own.id);
    if (!now) return newElementWith(own, { isDeleted: true });
    if (now.backgroundColor === own.backgroundColor) return own;
    return newElementWith(own, { backgroundColor: now.backgroundColor as string });
  });

  const held = new Set(scene.map((element) => element.id));
  const made = edit.elements.find((element) => !held.has(element.id));
  if (made) {
    const [restored] = restoreElements(
      [made] as unknown as Parameters<typeof restoreElements>[0],
      null,
    );
    const ground =
      restored &&
      newElementWith(restored, {
        frameId: page.id,
        locked: true,
        customData: made.customData as Record<string, unknown>,
      });
    if (ground) elements.splice(edit.elements.indexOf(made), 0, ground);
  }

  api.updateScene({
    elements: elements as ExcalidrawInitialDataState["elements"],
    captureUpdate: preview ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY,
  });

  return edit.colour;
}

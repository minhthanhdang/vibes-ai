"use client";

import { exportToCanvas } from "@excalidraw/excalidraw";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/scene/excalidraw-assets";
import { ensureGoogleFontsFor } from "@/lib/scene/excalidraw-google-fonts";
import { BOARD_RENDER_CONTENT_TYPE, BOARD_RENDER_MAX_DIMENSION } from "@/lib/scene/moodboard-render";
import { isPageElement, type BoardPage } from "@/lib/pages/board-pages";
import { pageExportElements } from "@/lib/pages/page-picture";
import type { MoodboardScene } from "@/server/api/routers/moodboard";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";

export const PREVIEW_SLIDE_MAX_DIMENSION = BOARD_RENDER_MAX_DIMENSION;
export const PREVIEW_THUMB_MAX_DIMENSION = 240;

window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;

export async function pageCanvas(
  scene: MoodboardScene,
  page: BoardPage,
  maxDimension: number,
): Promise<HTMLCanvasElement | null> {
  const elements = scene.elements as unknown as readonly NonDeletedExcalidrawElement[];
  const frame = elements.find((element) => element.id === page.id && isPageElement(element));
  if (!frame) return null;

  return exportToCanvas({
    elements: pageExportElements(elements, page),
    appState: {
      ...(scene.appState as Partial<AppState>),
      exportBackground: true,
      exportWithDarkMode: false,
      exportEmbedScene: false,
    },
    files: Object.fromEntries(scene.files.map((file) => [file.id, file])) as BinaryFiles,
    maxWidthOrHeight: maxDimension,
    exportingFrame: frame as ExcalidrawFrameLikeElement,
  });
}

export function canvasBlob(
  canvas: HTMLCanvasElement,
  contentType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, contentType, quality));
}

export async function pageBitmapUrl(
  scene: MoodboardScene,
  page: BoardPage,
  maxDimension: number,
): Promise<string | null> {
  await ensureGoogleFontsFor(scene.elements);

  const canvas = await pageCanvas(scene, page, maxDimension);
  if (!canvas) return null;

  const blob = await canvasBlob(canvas, BOARD_RENDER_CONTENT_TYPE);
  return blob ? URL.createObjectURL(blob) : null;
}

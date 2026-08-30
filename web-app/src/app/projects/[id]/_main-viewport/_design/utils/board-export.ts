"use client";

import { exportToBlob, exportToClipboard } from "@excalidraw/excalidraw";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import {
  BOARD_EXPORT_FORMATS,
  BOARD_EXPORT_PADDING,
  boardExportElements,
  boardExportFileName,
  exportPixelRatio,
  exportedFrame,
  type BoardExportSettings,
} from "@/lib/scene/moodboard-export";
import { boardPages } from "@/lib/pages/board-pages";
import { pageExportElements } from "@/lib/pages/page-picture";
import { sceneImageVariants } from "@/lib/scene/moodboard-resolution";
import { referenceFileId, type SceneElement } from "@/lib/scene/moodboard-scene";
import { referenceCanvasImagePath } from "@/server/references/display";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";

const EXPORT_FETCH_CONCURRENCY = 4;

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read image bytes"));
    reader.readAsDataURL(blob);
  });
}

async function exportFiles(
  api: ExcalidrawImperativeAPI,
  elements: readonly unknown[],
  settings: BoardExportSettings,
): Promise<BinaryFiles> {
  const files: BinaryFiles = { ...api.getFiles() };
  const variants = [
    ...sceneImageVariants(elements as SceneElement[], exportPixelRatio(settings)),
  ];

  const fetched = await mapWithConcurrency(
    variants,
    EXPORT_FETCH_CONCURRENCY,
    async ([referenceId, variant]) => {
      const response = await fetch(
        referenceCanvasImagePath(referenceId, variant === "thumb" ? "thumb" : undefined),
      );
      if (!response.ok) throw new Error(`reference ${referenceId}: ${response.status}`);
      const blob = await response.blob();
      return { referenceId, dataURL: await dataUrlOf(blob), mimeType: blob.type };
    },
  );

  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    const { referenceId, dataURL, mimeType } = result.value;
    const id = referenceFileId(referenceId) as BinaryFileData["id"];
    files[id] = {
      ...files[id],
      id,
      dataURL: dataURL as BinaryFileData["dataURL"],
      mimeType: (mimeType || "image/jpeg") as BinaryFileData["mimeType"],
      created: files[id]?.created ?? Date.now(),
    };
  }

  return files;
}

function exportedPage(
  elements: readonly NonDeletedExcalidrawElement[],
  appState: unknown,
  settings: BoardExportSettings,
) {
  const frame = exportedFrame(elements, appState, settings.selectionOnly);
  return { frame, page: frame ? (boardPages([frame])[0] ?? null) : null };
}

async function exportInputs(api: ExcalidrawImperativeAPI, settings: BoardExportSettings) {
  const state = api.getAppState();
  const scene = api.getSceneElements();
  const { frame, page } = exportedPage(scene, state, settings);
  const selected = boardExportElements(scene, state, settings.selectionOnly);
  const elements = page ? pageExportElements(selected, page) : selected;

  return {
    elements,
    page,
    exportingFrame: (frame as ExcalidrawFrameLikeElement | null) ?? null,
    files: await exportFiles(api, elements, settings),
    appState: {
      ...state,
      exportBackground: settings.background,
      exportScale: settings.scale,
      exportWithDarkMode: false,
      exportEmbedScene: false,
    },
  };
}

function scaledTo(scale: number) {
  return (width: number, height: number) => ({
    width: width * scale,
    height: height * scale,
    scale,
  });
}

function paddingAround(exportingFrame: ExcalidrawFrameLikeElement | null) {
  return exportingFrame ? 0 : BOARD_EXPORT_PADDING;
}

export type BoardExportFile = { blob: Blob; filename: string };

export async function exportBoardImage(
  api: ExcalidrawImperativeAPI,
  settings: BoardExportSettings,
  title: string,
): Promise<BoardExportFile> {
  const { elements, files, appState, exportingFrame, page } = await exportInputs(api, settings);
  if (elements.length === 0) throw new Error("There is nothing on this board to export.");

  const blob = await exportToBlob({
    elements,
    appState,
    files,
    exportingFrame,
    mimeType: BOARD_EXPORT_FORMATS.png.mimeType,
    exportPadding: paddingAround(exportingFrame),
    getDimensions: scaledTo(settings.scale),
  });

  return { blob, filename: boardExportFileName(title, settings.format, page?.name) };
}

export async function copyBoardImage(
  api: ExcalidrawImperativeAPI,
  settings: BoardExportSettings,
): Promise<void> {
  const { elements, files, appState, exportingFrame } = await exportInputs(api, settings);
  if (elements.length === 0) throw new Error("There is nothing on this board to export.");

  await exportToClipboard({
    type: settings.format,
    elements,
    exportingFrame,
    appState,
    files,
    exportPadding: paddingAround(exportingFrame),
    getDimensions: scaledTo(settings.scale),
  });
}

export function downloadFile({ blob, filename }: BoardExportFile) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

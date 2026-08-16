"use client";

import { exportToBlob, exportToClipboard, exportToSvg } from "@excalidraw/excalidraw";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  BOARD_EXPORT_FORMATS,
  BOARD_EXPORT_PADDING,
  boardExportElements,
  boardExportFileName,
  exportPixelRatio,
  type BoardExportSettings,
} from "@/lib/moodboard-export";
import { sceneImageVariants } from "@/lib/moodboard-resolution";
import { referenceFileId, type SceneElement } from "@/lib/moodboard-scene";
import { referenceCanvasImagePath } from "@/server/references/display";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

/// Turning the board into a file, at the resolution the file is drawn at and
/// with the photos inside it rather than pointed at.
///
/// The editor's own file map cannot be used for either. It holds the copy the
/// *board* needs — a 640px thumbnail behind a 320-unit tile — and it holds it as
/// an app URL, which is what makes an exported SVG a page of broken boxes for
/// anyone without a session here. Both are decided per export instead.

const EXPORT_FETCH_CONCURRENCY = 4;

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read image bytes"));
    reader.readAsDataURL(blob);
  });
}

/// The file map the export draws from: every reference the exported elements
/// name, fetched at the copy this output needs and inlined as a real `data:`
/// URL.
///
/// A reference that cannot be fetched keeps the editor's own entry rather than
/// failing the export — the photo comes out at board resolution, which is what
/// it looked like on screen, and that is strictly better than no file at all.
/// Anything that is not a `ref:` pointer is carried through untouched: an image
/// pasted seconds ago and not yet adopted still has its bytes there.
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

/// Everything the two output paths share. `exportWithDarkMode` is forced off
/// whatever the board is being viewed in: excalidraw's dark theme inverts every
/// vector element and counter-inverts only images, so a dark export of a board
/// with a §II.5 palette bar on it states colours that are not the ones analyzed.
/// `exportEmbedScene` is off because the scene it would embed is only readable
/// by excalidraw's own scene import, which §III does not port.
async function exportInputs(api: ExcalidrawImperativeAPI, settings: BoardExportSettings) {
  const state = api.getAppState();
  const elements = boardExportElements(api.getSceneElements(), state, settings.selectionOnly);

  return {
    elements,
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

/// `exportToCanvas` only reads `appState.exportScale` when it is also given a
/// maximum dimension; the documented way to ask for a scale outright is this.
function scaledTo(scale: number) {
  return (width: number, height: number) => ({
    width: width * scale,
    height: height * scale,
    scale,
  });
}

/// Excalidraw returns an SVG *element*, not a file — serialising it is the
/// caller's job, and the one thing that makes it a self-contained document is
/// the file map above, whose `data:` URLs land verbatim in each `<image href>`.
async function exportedSvg(
  elements: Awaited<ReturnType<typeof exportInputs>>["elements"],
  appState: Awaited<ReturnType<typeof exportInputs>>["appState"],
  files: BinaryFiles,
): Promise<Blob> {
  const svg = await exportToSvg({ elements, appState, files, exportPadding: BOARD_EXPORT_PADDING });
  return new Blob([svg.outerHTML], { type: BOARD_EXPORT_FORMATS.svg.mimeType });
}

export type BoardExportFile = { blob: Blob; filename: string };

export async function exportBoardImage(
  api: ExcalidrawImperativeAPI,
  settings: BoardExportSettings,
  title: string,
): Promise<BoardExportFile> {
  const { elements, files, appState } = await exportInputs(api, settings);
  if (elements.length === 0) throw new Error("There is nothing on this board to export.");

  const blob =
    settings.format === "svg"
      ? await exportedSvg(elements, appState, files)
      : await exportToBlob({
          elements,
          appState,
          files,
          mimeType: BOARD_EXPORT_FORMATS.png.mimeType,
          exportPadding: BOARD_EXPORT_PADDING,
          getDimensions: scaledTo(settings.scale),
        });

  return { blob, filename: boardExportFileName(title, settings.format) };
}

/// The same file, put on the clipboard instead of on disk — which is how a board
/// most often actually travels: into a message, a doc, a deck being written
/// beside it.
export async function copyBoardImage(
  api: ExcalidrawImperativeAPI,
  settings: BoardExportSettings,
): Promise<void> {
  const { elements, files, appState } = await exportInputs(api, settings);
  if (elements.length === 0) throw new Error("There is nothing on this board to export.");

  await exportToClipboard({
    type: settings.format,
    elements,
    appState,
    files,
    exportPadding: BOARD_EXPORT_PADDING,
    getDimensions: scaledTo(settings.scale),
  });
}

export function downloadFile({ blob, filename }: BoardExportFile) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  /// Revoked a tick later rather than immediately: the click starts the download
  /// asynchronously, and pulling the URL out from under it cancels the save in
  /// some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

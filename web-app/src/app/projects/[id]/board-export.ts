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

/// Turning the board into a file, at the resolution the file is drawn at and
/// with the photos inside it rather than pointed at.
///
/// The editor's own file map cannot be used for either. It holds the copy the
/// *board* needs — a 640px thumbnail behind a 320-unit tile — and it holds it as
/// an app URL only this app can serve. Both are decided per export instead.
///
/// One output: a PNG, or the same picture on the clipboard. The SVG path is gone
/// (`moodboard-export.ts` carries why).

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

/// The page the export is a picture of, if it is one — the selected frame read
/// back as a §V.1 page, so the file can be the page rect and everything geometry
/// puts on it can be drawn inside that rect.
///
/// `pageExportElements` is the same rewrite the page's own render takes (§V.5):
/// excalidraw draws a frame's picture from what overlaps it *and* is owned by
/// nobody else, so a photograph sitting squarely on this page while its
/// `frameId` still names the page it was dragged off is dropped from the file
/// alone — while every page read in the app describes it as being on the page.
/// Nothing is written back; this is a copy made for the exporter.
function exportedPage(
  elements: readonly NonDeletedExcalidrawElement[],
  appState: unknown,
  settings: BoardExportSettings,
) {
  const frame = exportedFrame(elements, appState, settings.selectionOnly);
  return { frame, page: frame ? (boardPages([frame])[0] ?? null) : null };
}

/// Everything the download and the copy share. `exportWithDarkMode` is forced off
/// whatever the board is being viewed in: excalidraw's dark theme inverts every
/// vector element and counter-inverts only images, so a dark export of a board
/// with a §II.5 palette bar on it states colours that are not the ones analyzed.
/// `exportEmbedScene` is off because the scene it would embed is only readable
/// by excalidraw's own scene import, which §III does not port.
async function exportInputs(api: ExcalidrawImperativeAPI, settings: BoardExportSettings) {
  const state = api.getAppState();
  const scene = api.getSceneElements();
  const { frame, page } = exportedPage(scene, state, settings);
  const selected = boardExportElements(scene, state, settings.selectionOnly);
  const elements = page ? pageExportElements(selected, page) : selected;

  return {
    elements,
    page,
    /// Given to excalidraw rather than merely selected: it is what makes the file
    /// the frame's own rectangle — no padding, no outline and no name label — in
    /// place of a bounding box of the frame and whatever hangs over its edge.
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

/// `exportToCanvas` only reads `appState.exportScale` when it is also given a
/// maximum dimension; the documented way to ask for a scale outright is this.
function scaledTo(scale: number) {
  return (width: number, height: number) => ({
    width: width * scale,
    height: height * scale,
    scale,
  });
}

/// None around a frame being exported as itself: the file is that rectangle, and
/// a page with a margin of board around it is a page nobody can lay beside
/// another. Excalidraw forces the same zero on its own, said here so neither
/// output reads as asking for something it will not get.
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

/// The same file, put on the clipboard instead of on disk — which is how a board
/// most often actually travels: into a message, a doc, a deck being written
/// beside it.
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
  /// Revoked a tick later rather than immediately: the click starts the download
  /// asynchronously, and pulling the URL out from under it cancels the save in
  /// some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

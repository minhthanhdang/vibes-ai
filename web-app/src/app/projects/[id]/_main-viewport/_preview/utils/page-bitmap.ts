"use client";

import { exportToCanvas } from "@excalidraw/excalidraw";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/scene/excalidraw-assets";
import { BOARD_RENDER_CONTENT_TYPE, BOARD_RENDER_MAX_DIMENSION } from "@/lib/scene/moodboard-render";
import { isPageElement, type BoardPage } from "@/lib/pages/board-pages";
import { pageExportElements } from "@/lib/pages/page-picture";
import type { MoodboardScene } from "@/server/api/routers/moodboard";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";

/// One page of a stored scene, drawn to a bitmap the Preview tab can put in an
/// `<img>` (PRD §III.2). The browser's own exporter against the same bytes the
/// editor draws, so fidelity is exact by construction — no server render, no
/// GCS round-trip, no staleness beyond the scene fetch itself.
///
/// The files come straight off the scene: `SceneFile.dataURL` is the app's own
/// `/api/references/…?stream=1` path, streamed same-origin exactly so an export
/// canvas is not tainted (`display.ts`). The copies are the ones sized for the
/// on-screen board, which is the fidelity bet stated above — this is a preview
/// of what the editor shows, not the deck-grade re-fetch `board-export.ts` does.

/// The main slide draws at the board render's cap; a thumbnail is drawn once at
/// its own small size rather than downscaled from the big one, so a strip of
/// boards is cheap to fill.
export const PREVIEW_SLIDE_MAX_DIMENSION = BOARD_RENDER_MAX_DIMENSION;
export const PREVIEW_THUMB_MAX_DIMENSION = 240;

/// Same constraint as `design-canvas.tsx`: excalidraw resolves its `@font-face`
/// against a CDN unless told where the mirrored fonts live, and it decides at
/// the first draw — which, on a tab that never mounts the editor, is this
/// module's export. Module scope of a chunk that only loads client-side.
window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;

export async function pageBitmapUrl(
  scene: MoodboardScene,
  page: BoardPage,
  maxDimension: number,
): Promise<string | null> {
  const elements = scene.elements as unknown as readonly NonDeletedExcalidrawElement[];
  /// The frame as excalidraw holds it: the exporter is given the element, and a
  /// page gone from the scene since the pages were read is no bitmap at all.
  const frame = elements.find((element) => element.id === page.id && isPageElement(element));
  if (!frame) return null;

  const canvas = await exportToCanvas({
    /// The same adoption rewrite every frame export takes (`page-picture.ts`):
    /// without it, a photo sitting on the page while its `frameId` names the
    /// page it was dragged off silently vanishes from the bitmap.
    elements: pageExportElements(elements, page),
    /// Dark mode forced off for the reason `board-export.ts` states: the dark
    /// theme inverts every vector element, and a preview is of the board's own
    /// colours, not the viewing theme's.
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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, BOARD_RENDER_CONTENT_TYPE),
  );
  return blob ? URL.createObjectURL(blob) : null;
}

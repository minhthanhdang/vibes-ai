import { boardPages, boxOnPage, isFrameElement, type BoardPage } from "@/lib/pages/board-pages";
import type { Rect } from "@/lib/canvas/moodboard-frames";

export type BoardExportFormat = "png";

export const BOARD_EXPORT_FORMATS = {
  png: { extension: "png", mimeType: "image/png", label: "PNG" },
} as const satisfies Record<BoardExportFormat, { extension: string; mimeType: string; label: string }>;

export const BOARD_EXPORT_SCALES = [1, 2, 3] as const;
export type BoardExportScale = (typeof BOARD_EXPORT_SCALES)[number];

export const BOARD_EXPORT_PADDING = 24;

export type BoardExportSettings = {
  format: BoardExportFormat;
  scale: BoardExportScale;
  background: boolean;
  selectionOnly: boolean;
};

export const DEFAULT_BOARD_EXPORT: BoardExportSettings = {
  format: "png",
  scale: 2,
  background: true,
  selectionOnly: false,
};

export function exportPixelRatio(settings: Pick<BoardExportSettings, "scale">): number {
  return settings.scale;
}

export function boardExportFileName(
  title: unknown,
  format: BoardExportFormat,
  page?: unknown,
): string {
  const named = [slugOf(title), slugOf(page)].filter(Boolean).join("-");
  return `${named || "moodboard"}.${BOARD_EXPORT_FORMATS[format].extension}`;
}

function slugOf(name: unknown): string {
  if (typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

type ExportableElement = {
  id?: unknown;
  frameId?: unknown;
  isDeleted?: unknown;
  [key: string]: unknown;
};

function selectedIds(appState: unknown): Set<string> {
  const selection =
    typeof appState === "object" && appState !== null
      ? (appState as { selectedElementIds?: unknown }).selectedElementIds
      : null;
  if (typeof selection !== "object" || selection === null) return new Set();

  return new Set(
    Object.entries(selection as Record<string, unknown>)
      .filter(([, picked]) => picked === true)
      .map(([id]) => id),
  );
}

export function hasExportableSelection(elements: readonly ExportableElement[], appState: unknown) {
  const picked = selectedIds(appState);
  return elements.some((element) => !element.isDeleted && picked.has(String(element.id)));
}

export function boardExportElements<T extends ExportableElement>(
  elements: readonly T[],
  appState: unknown,
  selectionOnly: boolean,
): T[] {
  const live = elements.filter((element) => !element.isDeleted);
  if (!selectionOnly) return live;

  const picked = selectedIds(appState);
  const pages = boardPages(live).filter((page) => picked.has(page.id));
  const chosen = live.filter(
    (element) =>
      picked.has(String(element.id)) ||
      (typeof element.frameId === "string" && picked.has(element.frameId)) ||
      onSelectedPage(pages, element),
  );

  return chosen.length > 0 ? chosen : live;
}

function onSelectedPage(pages: readonly BoardPage[], element: ExportableElement): boolean {
  if (pages.length === 0) return false;
  const box = exportBox(element);
  return box !== null && pages.some((page) => boxOnPage(page, box));
}

function exportBox(element: ExportableElement): Rect | null {
  const box = { x: element.x, y: element.y, width: element.width, height: element.height };
  const readable = Object.values(box).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  return readable ? (box as Rect) : null;
}

export function exportedFrame<T extends ExportableElement>(
  elements: readonly T[],
  appState: unknown,
  selectionOnly: boolean,
): T | null {
  if (!selectionOnly) return null;

  const picked = selectedIds(appState);
  if (picked.size !== 1) return null;

  const chosen = elements.find(
    (element) => !element.isDeleted && picked.has(String(element.id)),
  );
  return chosen && isFrameElement(chosen) ? chosen : null;
}

export function exportedPageName(
  elements: readonly ExportableElement[],
  appState: unknown,
): string | null {
  const frame = exportedFrame(elements, appState, true);
  return frame ? (boardPages([frame])[0]?.name ?? null) : null;
}

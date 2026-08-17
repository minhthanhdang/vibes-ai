import { boardPages, boxOnPage, isFrameElement, type BoardPage } from "@/lib/pages/board-pages";
import type { Rect } from "@/lib/canvas/moodboard-frames";

/// Exporting is the one moment a board leaves this app, and it is the moment it
/// stops being ours to fix. A PNG sent to a client, an SVG dropped into a deck —
/// whatever is in that file is what the work looks like to everyone who is not
/// the director, and neither of the two things that decide it is visible on the
/// board.
///
/// Both were wrong. The editor's files map holds the copy of each photo the
/// *board* needs (§II.6: a 320-unit tile is served a 640px thumbnail), and
/// excalidraw exports from that map — so a 3× PNG of a moodboard was drawn by
/// upscaling thumbnails, and nothing on screen said so. And an SVG embeds each
/// file entry's `dataURL` verbatim as an `<image href>`, which for this board is
/// an app URL behind the director's own session: every photo in an exported SVG
/// is a broken box for whoever opens it.
///
/// So an export builds its own file map rather than reusing the board's — at the
/// resolution the *output* draws at, and as real `data:` URLs, which is what
/// makes the file stand on its own. This module is the part of that with no
/// canvas, fetch or excalidraw in it.

export type BoardExportFormat = "png" | "svg";

export const BOARD_EXPORT_FORMATS = {
  png: { extension: "png", mimeType: "image/png", label: "PNG" },
  svg: { extension: "svg", mimeType: "image/svg+xml", label: "SVG" },
} as const satisfies Record<BoardExportFormat, { extension: string; mimeType: string; label: string }>;

/// Excalidraw's own three, kept: they are the scales a director already knows
/// from every other export dialog, and 2× is what a board is judged at anyway.
export const BOARD_EXPORT_SCALES = [1, 2, 3] as const;
export type BoardExportScale = (typeof BOARD_EXPORT_SCALES)[number];

/// The same padding the board's own picture uses, so an exported board and the
/// preview in the tab row are cropped alike.
export const BOARD_EXPORT_PADDING = 24;

export type BoardExportSettings = {
  format: BoardExportFormat;
  scale: BoardExportScale;
  background: boolean;
  selectionOnly: boolean;
};

/// 2× because that is the ratio the board itself is drawn at — an export at 1×
/// is a screenshot of a display nobody has, and 3× is four times the bytes for a
/// difference only a print notices. Background on: a moodboard exported
/// transparent is a collage on whatever the recipient's viewer happens to be.
export const DEFAULT_BOARD_EXPORT: BoardExportSettings = {
  format: "png",
  scale: 2,
  background: true,
  selectionOnly: false,
};

/// What one scene unit becomes in the exported file. This is the whole reason
/// the export cannot reuse the board's file map: on screen a unit is two device
/// pixels and a thumbnail covers a 320-unit tile exactly, and at 3× the same
/// tile is 960 pixels of a photo that was served at 640.
export function exportPixelRatio(settings: Pick<BoardExportSettings, "scale">): number {
  return settings.scale;
}

/// A name the director can find again. Anything that is not a letter or a digit
/// becomes a separator — in any script, so a board named in Vietnamese keeps its
/// title rather than falling back to the generic one.
///
/// A page of the board carries its own name into the file: exporting three pages
/// of a spread one after another is the ordinary use of a page export, and three
/// files called `cold-open.png` are three copies of the same question.
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

/// Whether "only what is selected" is a question worth asking. Offered on any
/// selection at all rather than on two or more: exporting one photo with the
/// caption bound to it is a normal thing to want out of a board.
export function hasExportableSelection(elements: readonly ExportableElement[], appState: unknown) {
  const picked = selectedIds(appState);
  return elements.some((element) => !element.isDeleted && picked.has(String(element.id)));
}

/// The elements the file is of.
///
/// Selecting a *frame* selects the section, not an empty rectangle — its photos
/// are exported with it. Excalidraw's own export makes the same reading, and
/// without it "export the selection" on a board divided into acts produces a
/// labelled outline with nothing in it.
///
/// A selected **page** takes what is *on* it rather than what it owns (§V.3):
/// membership is geometric everywhere else in this app — the page brief, the
/// page's picture, the tidy — and a photo dropped on a page it was never adopted
/// by is a photo every page read describes and the file would have left out.
///
/// A selection-only export with nothing selected falls back to the whole board:
/// the setting outlives the selection that was on screen when it was made, and
/// an empty file is never what was being asked for.
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

/// The rectangle rule rather than iteration 36's exclusive one, for the same
/// reason the page's own render uses it: a file is what the page *looks* like,
/// and a photograph lying where two pages overlap is drawn on both of them.
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

/// The frame a selection-only export is a *picture of*, rather than one more
/// element in a bounding box.
///
/// Excalidraw's own export dialog does exactly this — one frame selected and
/// nothing else means the file is that frame's rectangle, with no padding, no
/// outline and no name label drawn into it — and this board replaced that dialog
/// (§II) without carrying the rule across. For a page that is the whole point:
/// §V says one page is one picture, so exporting a page has to produce the page,
/// not a labelled rectangle of it floating in 24px of background.
///
/// Exactly one element selected, deliberately: a page picked together with a
/// photograph somewhere else on the canvas is a director asking for both, and
/// the honest answer to that is the bounding box they framed.
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

/// The same question asked for the sentence on the export's own toggle: what a
/// selection-only export would be a picture of, in the director's word for it.
/// `null` when the selection is not one page — a section is a rectangle too, but
/// "only the page" is a claim about what the file will be, and only a page can
/// stand behind it (§V) — and `""` for a page nobody has named.
export function exportedPageName(
  elements: readonly ExportableElement[],
  appState: unknown,
): string | null {
  const frame = exportedFrame(elements, appState, true);
  return frame ? (boardPages([frame])[0]?.name ?? null) : null;
}

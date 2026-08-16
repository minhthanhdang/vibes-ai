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
export function boardExportFileName(title: unknown, format: BoardExportFormat): string {
  const slug =
    typeof title === "string"
      ? title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80)
          .replace(/-+$/, "")
      : "";

  return `${slug || "moodboard"}.${BOARD_EXPORT_FORMATS[format].extension}`;
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
  const chosen = live.filter(
    (element) =>
      picked.has(String(element.id)) ||
      (typeof element.frameId === "string" && picked.has(element.frameId)),
  );

  return chosen.length > 0 ? chosen : live;
}

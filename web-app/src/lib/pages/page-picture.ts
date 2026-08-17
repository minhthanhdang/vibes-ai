import { pageHolding } from "@/lib/pages/board-pages";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";

/// The picture of an attached page (§V.5.1), as the rules for taking one.
///
/// The browser is authoritative for exactly one thing about a page — what it
/// looks like — because a canvas is the only place an element array can be
/// drawn. Everything the model *reads* about the page is built on the server
/// from the stored scene, so this module is deliberately small: which of the
/// picked pages can be pictured at all, and whether a picture taken now would be
/// of the scene the server holds.
///
/// No canvas, no React, no DOM. The export and the upload live in the tab that
/// has the board open; only the decisions are here.

export type PagePicture = {
  boardId: string;
  pageId: string;
  /// The revision the picture is of, read *after* the pending save landed rather
  /// than the one the page was picked at. The object in the bucket is named with
  /// it and the message carries it back, so the two have to be the same moment:
  /// a picture labelled with the revision the picker last listed is a picture of
  /// whatever the director has drawn since.
  revision: number;
  renderUri: string;
};

/// The picks a tab could actually draw: pages of the board it is showing, in the
/// order they were picked.
///
/// A page of any other board has no canvas mounted on it — its scene is not
/// loaded and its photographs are not hydrated — so nothing here can picture it
/// and it goes up as text alone, which the attachment is built to survive
/// (§V.5.3 says so in the text rather than leaving the model to assume an image
/// it cannot see is above the words).
export function pagesToPicture<T extends { boardId: string }>(
  picked: readonly T[],
  openBoardId: string | null,
): T[] {
  if (!openBoardId) return [];
  return picked.filter((page) => page.boardId === openBoardId);
}

/// Whether a picture taken now is a picture of the scene the server holds.
///
/// Only an idle board. A board mid-save is one whose revision is about to move,
/// so the picture would be labelled with the wrong one and the server would drop
/// it — a wasted export rather than a wrong answer.
///
/// A failed or conflicted save is the case that matters: there the revision has
/// stopped moving while the canvas keeps changing, so a picture of what is on
/// screen goes up labelled with a revision the server *does* match, and it is
/// handed to the model as a picture of a scene nobody stored. That is the one
/// lie this check exists to stop.
export function pictureIsOfStoredScene(status: AutosaveStatus) {
  return status === "idle";
}

/// The scene as the exporter has to see it to draw one page.
///
/// Excalidraw draws a frame's picture from the elements that overlap it *and*
/// are not owned by another frame — so a photograph sitting squarely on this page
/// while its `frameId` still names the page it was dragged off is left out of the
/// render, and only of the render: every page read in this codebase decides
/// membership by geometry (§V.3), so the server would describe that photograph as
/// being on this page and the model would be handed a picture without it.
///
/// So what geometry puts on the page is adopted by it for the export. Nothing is
/// written back — this is a copy made for the exporter, and the scene the
/// director is editing keeps whatever `frameId` it had.
///
/// Only in this direction. An element the page still owns but that has been
/// dragged off it is left alone: it falls outside the rectangle being drawn, and
/// the sliver of it that does not is what the page actually looks like.
export function pageExportElements<
  T extends {
    x: number;
    y: number;
    width: number;
    height: number;
    frameId?: string | null;
  },
>(elements: readonly T[], page: BoardPage): T[] {
  return elements.map((element) =>
    element.frameId !== page.id && pageHolding([page], element)?.id === page.id
      ? Object.assign({}, element, { frameId: page.id })
      : element,
  );
}

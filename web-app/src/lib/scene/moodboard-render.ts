import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";

/// A board is a document until something has looked at it. This is the rule for
/// the picture of it — when one is worth taking, how large it is and where it
/// lives — with no canvas, no bucket and no React in it.
///
/// The picture exists because everything downstream of a board needs to see it
/// without opening it: the tab row, and agent 5, which builds a deck out of what
/// the board actually looks like rather than out of its element array.

/// Large enough to read a photo on a slide, small enough that taking one is not
/// something the director notices. A board is composed at a few thousand units
/// across, so this is roughly a 1:1 render of a normal one and a downscale of a
/// sprawling one.
export const BOARD_RENDER_MAX_DIMENSION = 1600;

/// Excalidraw exports the content's bounding box exactly; without this the
/// outermost stroke sits on the edge of the image.
export const BOARD_RENDER_PADDING = 24;

/// PNG rather than JPEG: a board is flat colour, text and hard edges over a
/// canvas background, which is what PNG is for — and a board exported with a
/// transparent background has no JPEG equivalent at all.
export const BOARD_RENDER_CONTENT_TYPE = "image/png";

/// Far longer than the autosave waits, because nothing is lost by waiting: the
/// scene is already stored, and this is only the picture of it. Drawing a whole
/// board to an offscreen canvas and sending a megabyte of PNG is orders of
/// magnitude more than a save costs, so it is worth doing only once the director
/// has stopped changing what the picture would be of — a board being actively
/// arranged is quiet for a second at a time and never for this long.
export const BOARD_RENDER_DELAY_MS = 20_000;

/// One object per board, overwritten in place. A new path per render would make
/// every save of a board leave the previous picture behind, paid for forever and
/// pointed at by nothing.
export function boardRenderObjectPath(projectId: string, boardId: string) {
  return `projects/${projectId}/boards/${boardId}/render.png`;
}

/// Whether a board's stored picture is of the scene the row currently holds.
/// A duplicate starts at revision 0 with exactly the source's scene, so it can
/// inherit the picture — but only this one: a render taken two revisions ago is
/// a picture of a board that no longer exists, and copying it would give the new
/// board a preview that is wrong from the moment it is made.
export function boardRenderIsCurrent(board: {
  renderUri: string | null;
  renderRevision: number | null;
  revision: number;
}) {
  return board.renderUri !== null && board.renderRevision === board.revision;
}

export type BoardRenderNeed = {
  /// The autosave's view of the board. Only an idle board is worth rendering:
  /// the picture is labelled with the revision the server holds, so taking one
  /// while a write is queued would label the wrong scene.
  status: AutosaveStatus;
  /// The revision the server holds — what a render taken now would be of.
  revision: number;
  /// The revision the stored render was taken from, null when there is none.
  renderedRevision: number | null;
  /// The last revision a render was attempted at, whether or not it worked.
  /// A failed render is not data loss — the scene is saved either way — so it is
  /// retried when the board changes again rather than immediately and forever.
  attemptedRevision: number | null;
  /// Nothing on the canvas is nothing to draw: excalidraw exports the content's
  /// bounding box, and an empty board's is empty. A blank picture is worse than
  /// no picture, because the tab row cannot tell the two apart.
  elementCount: number;
};

export function boardRenderNeeded({
  status,
  revision,
  renderedRevision,
  attemptedRevision,
  elementCount,
}: BoardRenderNeed) {
  if (status !== "idle") return false;
  if (elementCount === 0) return false;
  if (renderedRevision === revision) return false;
  return attemptedRevision !== revision;
}

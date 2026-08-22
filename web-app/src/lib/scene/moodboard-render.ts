import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";

/// A board is a document until something has looked at it. This is the rule for
/// the picture of it — when one is worth taking, how large it is and where it
/// lives — with no canvas, no bucket and no React in it.
///
/// The picture exists because everything downstream of a board needs to see it
/// without opening it: the tab row, and agent 5, which builds a deck out of what
/// the board actually looks like rather than out of its element array.

/// Large enough to read a photo on a slide, small enough that taking one is not
/// something the user notices. A board is composed at a few thousand units
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
/// magnitude more than a save costs, so it is worth doing only once the user
/// has stopped changing what the picture would be of — a board being actively
/// arranged is quiet for a second at a time and never for this long.
export const BOARD_RENDER_DELAY_MS = 20_000;

/// One object per board, overwritten in place. A new path per render would make
/// every save of a board leave the previous picture behind, paid for forever and
/// pointed at by nothing.
export function boardRenderObjectPath(projectId: string, boardId: string) {
  return `projects/${projectId}/boards/${boardId}/render.png`;
}

/// Where the picture of one page lives (§V.5). Unlike a board's, it is *not*
/// overwritten in place: the revision is in the name, because a page attached to
/// a message is a picture of the board as it stood when that message was sent, and
/// a later render landing on that object would rewrite what the model was shown
/// out from under the row that recorded it.
///
/// Derived from ids the server has already checked, so the uri the browser sends
/// back on the message can be held against this one — the client is authoritative
/// for the *picture* and for nothing else, least of all for which object in the
/// bucket the model is pointed at.
export function pageRenderObjectPath(
  projectId: string,
  boardId: string,
  pageId: string,
  revision: number,
) {
  return `projects/${projectId}/boards/${boardId}/pages/${pageId}@${revision}.png`;
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

/// Where a picture drawn *for a model* lives (§III.2), and a prefix of its own.
///
/// Two reasons, both about not mixing kinds of picture under one name. The
/// browser's page render above is a real excalidraw export and this one is an
/// approximation, so sharing a path would hand the model an exact export on some
/// rounds and a redrawing on others — two dialects for one read. And the
/// browser's object is the *user's* attachment: a server write into it would put
/// a picture the user never took where the row recording their message says
/// theirs is.
///
/// Not under `projects/<id>/` like everything else in the bucket, and that is
/// the whole point of the shape: a bucket lifecycle rule matches a literal
/// prefix, and `projects/*/renders/` is not one. Ids are already unique across
/// projects, so the project segment would buy nothing and cost the sweep.
export const MODEL_RENDER_PREFIX = "renders/";

/// A twelve-round turn can leave a dozen PNGs behind, and nothing ever reads an
/// old one — every read is at the revision it was just taken at. So they are
/// swept rather than kept, and the number is the lifecycle rule on the prefix.
///
/// The rule is set on the bucket rather than from here, and it has to be: the
/// app's identity has object access only and cannot read or set bucket metadata
/// (infra §IX). So this constant is the number an owner applies, through
/// `npm run bucket:lifecycle` on their own credential, rather than something the
/// app enforces at boot. Nothing breaks without it; the bucket only grows.
export const MODEL_RENDER_LIFECYCLE_DAYS = 7;

/// Per revision and never overwritten, for the reason the board's mutable
/// `render.png` is not usable here: a `fileData` uri handed to the model is
/// re-sent on every later round of the turn, so an object that can change under
/// it is a picture that stops being the one the answer was about.
export function modelPageRenderObjectPath(pageId: string, revision: number) {
  return `${MODEL_RENDER_PREFIX}pages/${pageId}@${revision}.png`;
}

export function modelBoardRenderObjectPath(boardId: string, revision: number) {
  return `${MODEL_RENDER_PREFIX}boards/${boardId}@${revision}.png`;
}

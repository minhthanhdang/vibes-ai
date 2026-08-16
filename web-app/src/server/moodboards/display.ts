/// The board's picture is a private object like a reference's, so the browser
/// gets an app URL rather than a bucket one. Unlike a reference's, the object at
/// that path is *overwritten* every time the board is re-rendered — so the
/// revision it was taken from is in the URL. Without it the bytes could not be
/// cached at all: a stable path plus a changing body is a stale preview on every
/// board the director has already looked at.
export function boardRenderPath(id: string, renderRevision: number) {
  return `/api/moodboards/${id}/render?r=${renderRevision}`;
}

import { isFrameElement, pageHolding } from "@/lib/pages/board-pages";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";

/// The picture of an attached page (§V.5.1), as the rules for taking one.
///
/// The browser is authoritative for exactly one thing about a page — what it
/// looks like — because a canvas is the only place an element array can be
/// drawn. Everything the model *reads* about the page is built on the server
/// from the stored scene, so this module is deliberately small: which of the
/// picked pages can be pictured at all, whether a picture taken now would be of
/// the scene the server holds, and how many times a tab whose board moved under
/// it tries again.
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

/// §V.5: "the tab re-renders once, and if it still disagrees the page goes up as
/// text only". Two attempts and never a third — the director pressed send, and a
/// board being edited while it is being sent can disagree forever.
export const PICTURE_ATTEMPTS = 2;

/// Whether the scene is still moving under the picture, read after the flush.
///
/// A save queued or in flight behind the one that was just flushed is an edit
/// the director made while the message was going up: the revision the picture
/// would be labelled with is already stale, and another flush has something to
/// settle on. A failed or conflicted save is the opposite — there the revision
/// has stopped while the canvas keeps changing, so the second attempt misses in
/// exactly the same way as the first and the page goes up as text.
export function sceneStillMoving(status: AutosaveStatus) {
  return status === "pending" || status === "saving";
}

/// Whether the board moved between the flush and the signature — the same miss
/// as above, caught at the other end.
///
/// The signer is asked for a url naming the revision the picture is of and
/// refuses with `CONFLICT` when the board has gone past it, which is the only
/// signal a tab has that its own picture is out of date: a write from another
/// tab lands with no `onChange` here. Read off the code rather than the class so
/// this module stays free of the client's transport; every other refusal it can
/// give (the page deleted, the board not the director's) is a miss that taking
/// the picture again cannot fix.
export function boardMovedUnderPicture(cause: unknown) {
  return codeOf(cause) === "CONFLICT";
}

function codeOf(cause: unknown) {
  if (typeof cause !== "object" || cause === null) return null;
  const data = (cause as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/// Taking the picture, as the order the two attempts happen in (§V.5).
///
/// The tab supplies the three things only a mounted canvas can do — settle the
/// pending save, say what the autosave has landed on, draw and upload one page at
/// a given revision — and this decides how many times they are asked. The picture
/// and the words are of one revision or they are of nothing, so an attempt that
/// finds the board past the revision it flushed to is worth exactly one more, at
/// whatever the board has landed on since.
///
/// `null` is a page going up as text alone, which the attachment is built to
/// survive: nothing here refuses a message over its illustration. A failure that
/// re-taking cannot fix is thrown to the caller, which logs it and does the same.
export async function pagePicture({
  flush,
  saved,
  draw,
}: {
  flush: () => Promise<void>;
  saved: () => { status: AutosaveStatus; revision: number };
  draw: (revision: number) => Promise<PagePicture | null>;
}): Promise<PagePicture | null> {
  for (let attempt = 1; attempt <= PICTURE_ATTEMPTS; attempt += 1) {
    const lastTry = attempt === PICTURE_ATTEMPTS;

    await flush();
    const { status, revision } = saved();
    if (!pictureIsOfStoredScene(status)) {
      if (lastTry || !sceneStillMoving(status)) return null;
      continue;
    }

    try {
      return await draw(revision);
    } catch (cause) {
      /// A board still moving under the last attempt is §V.5's own ending rather
      /// than a failure: the page goes up as text, and the director is not shown
      /// an error for a board they are still drawing on. Anything else — an
      /// upload that did not land, a page the signer will not sign for — is a
      /// real failure and the caller's to log.
      if (!boardMovedUnderPicture(cause)) throw cause;
      if (lastTry) return null;
    }
  }
  return null;
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
///
/// Frames are never rewritten — not the page itself, which sits inside its own
/// rectangle and would be handed to the exporter as its own child, and not a
/// section the page was drawn over, which §V.1 says a page cannot contain. Both
/// are drawn anyway: a frame owned by nothing is picked up by the overlap the
/// exporter does on its own, so the section still shows in the picture as the
/// rectangle the director drew. It is the *ownership* that excalidraw has no
/// rendering for.
export function pageExportElements<
  T extends {
    type?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    frameId?: string | null;
  },
>(elements: readonly T[], page: BoardPage): T[] {
  return elements.map((element) =>
    !isFrameElement(element) &&
    element.frameId !== page.id &&
    pageHolding([page], element)?.id === page.id
      ? Object.assign({}, element, { frameId: page.id })
      : element,
  );
}

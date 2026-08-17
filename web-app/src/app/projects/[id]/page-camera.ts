"use client";

import { pagesToPicture, type PagePicture } from "@/lib/pages/page-picture";
import type { PageChoice } from "@/lib/pages/page-attach";

/// How the chat gets a picture of a page it is about to send (§V.5.1).
///
/// The sixth cross-column module in this directory, and the first that is a
/// *call* rather than a fact: `board-selection` says which board is open,
/// `cut-taken` says what happened, and this asks the other column to do
/// something and waits for the answer. It has to be — the composer is in the
/// sidebar and the only thing that can draw an element array is the canvas in
/// the panel beside it.
///
/// Deliberately not an excalidraw import: this file is loaded by the sidebar,
/// and the editor is 1.5 MB that the whole panel is dynamically imported to keep
/// out of the first payload. What registers here is a closure the canvas module
/// owns; nothing about how a picture is taken is known on this side.
let mounted: { boardId: string; take: (pageId: string) => Promise<PagePicture | null> } | null =
  null;

/// Held while the tab is showing that board, and released when it stops — a
/// camera left registered by a board that has closed would be asked for a picture
/// of a scene nobody is holding any more. Last mount wins: one board is open at a
/// time, and a release only clears the registration it made.
export function holdPageCamera(
  boardId: string,
  take: (pageId: string) => Promise<PagePicture | null>,
) {
  mounted = { boardId, take };
  return () => {
    if (mounted?.boardId === boardId) mounted = null;
  };
}

/// The pictures for a message about to go up, in the order the pages were picked.
///
/// Everything here is best effort and nothing here refuses: a page of a board
/// that is not open, a canvas that has gone, an export that threw, an upload that
/// did not land — each of them is one page going up as text alone, which the
/// server already handles and says in the words the model reads. A director's
/// message is not worth failing over its illustration.
///
/// Taken one at a time rather than at once: each one flushes the board's pending
/// save, and two flushes racing on the same board would have the second draw
/// while the first is still writing.
export async function picturesForPages(
  picked: readonly PageChoice[],
): Promise<PagePicture[]> {
  const camera = mounted;
  if (!camera) return [];

  const pictures: PagePicture[] = [];
  for (const page of pagesToPicture(picked, camera.boardId)) {
    try {
      const picture = await camera.take(page.pageId);
      if (picture) pictures.push(picture);
    } catch (cause) {
      console.error(`page ${page.pageId} render failed:`, cause);
    }
  }
  return pictures;
}

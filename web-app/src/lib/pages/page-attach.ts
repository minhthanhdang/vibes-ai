import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import type { PageDigest } from "@/lib/pages/page-contents";

/// The pages the *director* picked, on their way up with one message (§V.5).
///
/// Every other page read in this codebase is one the model asked for —
/// `inspect_board` names a board and gets its pages back. This is the other
/// direction: a selection box in the chat, a page chosen by hand, and a message
/// that carries it. So the rules here are the ones a selection needs and a tool
/// call does not — picking the same page twice takes it back off, and a third
/// pick on a message that may carry two has to mean something rather than being
/// dropped on the floor.
///
/// What is picked is a *pointer*: which board, which page, and the revision the
/// board stood at when it was picked. Nothing that is said about the page is
/// decided here — the server builds all of that from the stored scene (§V.5.3),
/// because the browser is authoritative for the picture of a page and for nothing
/// else.
///
/// No canvas, no React, no DOM.

export type PageChoice = {
  boardId: string;
  pageId: string;
  /// What the board stood at when this page was listed. Carried so the server can
  /// tell whether a picture taken of it is still a picture of this board — and,
  /// on a text-only attachment, so the row records which scene was read.
  revision: number;
  /// The page's name as the picker showed it, kept for the chip under the
  /// composer. The prompt takes its own copy off the scene: this one is what the
  /// director sees, and it is allowed to be a moment behind.
  name: string;
};

/// A page is addressed by board *and* id, never by id alone: duplicating a board
/// copies its element ids verbatim, so two boards in one project can carry the
/// same page id.
export function pageChoiceKey(choice: Pick<PageChoice, "boardId" | "pageId">) {
  return `${choice.boardId}:${choice.pageId}`;
}

/// One click in the picker.
///
/// A page already picked is taken back off — the same tile is the on and the off,
/// because a selection the director cannot undo where they made it is a selection
/// they undo by sending the message and starting again.
///
/// Past the cap the oldest goes rather than the click being ignored: at two pages
/// a message, the third pick is the director changing their mind about the first
/// one, and a picker whose tiles stop responding once two are lit reads as broken.
export function pagesAfterPick(
  picked: readonly PageChoice[],
  choice: PageChoice,
  limit = PAGES_PER_MESSAGE,
): PageChoice[] {
  const key = pageChoiceKey(choice);
  const without = picked.filter((page) => pageChoiceKey(page) !== key);
  if (without.length < picked.length) return without;
  return [...without, choice].slice(-limit);
}

/// The picks held against the board as it now stands.
///
/// The picker's list is refetched — a page the director drew, renamed or deleted
/// while the message was half-written is a different list — and a pick naming a
/// page that is no longer on the board has to go: the server would drop it
/// silently on send (there is nobody in the loop to refuse to), which would leave
/// a chip under the composer claiming a page went up that never did.
///
/// Picks on *other* boards are left alone. The director can attach a page of one
/// board and then open another; only the board this list is of has anything to
/// say about them.
export function pagesStillOnBoard(
  picked: readonly PageChoice[],
  board: { boardId: string; revision: number; pages: readonly { pageId: string; name: string }[] },
): PageChoice[] {
  return picked.flatMap((choice) => {
    if (choice.boardId !== board.boardId) return [choice];
    const page = board.pages.find((listed) => listed.pageId === choice.pageId);
    if (!page) return [];
    /// Name and revision come from the fresh list rather than from the pick: what
    /// goes up is the page as it stands now, and a chip showing the name it had
    /// when it was clicked is the one thing here that could be a lie.
    ///
    /// A pick the list says nothing new about is handed back as itself, so a
    /// caller can tell "the selection did not change" by identity — this runs on
    /// every landing of a query the picker keeps fresh.
    return page.name === choice.name && board.revision === choice.revision
      ? [choice]
      : [{ ...choice, revision: board.revision, name: page.name }];
  });
}

/// What the chip says under the composer, beside the page's name: the two facts a
/// page is chosen between by (§V.5) — how big it is and how much is on it.
///
/// Blocks rather than pictures, because that is what the model will be handed: a
/// page's headline and captions are part of what it says, and a page listed as
/// holding two pictures and described to the model as five blocks is the picker
/// and the prompt disagreeing about the same rectangle.
export function pageChoiceNote(page: PageDigest) {
  const blocks = page.pictures + page.lines;
  return [
    `${page.width}×${page.height}`,
    `${blocks} ${blocks === 1 ? "block" : "blocks"}`,
    page.clipped ? `${page.clipped} over the edge` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/// The picks as the message carries them. The name is dropped on the way out: it
/// is the director's label for a tile on screen, and the server reads the page's
/// name off the scene it is describing rather than off the client's word for it.
export function attachedPageInput(picked: readonly PageChoice[]) {
  return picked.map(({ boardId, pageId, revision }) => ({ boardId, pageId, revision }));
}

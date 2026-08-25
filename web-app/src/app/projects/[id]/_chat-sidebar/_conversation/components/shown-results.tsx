"use client";

import { useState } from "react";
import {
  attachmentKey,
  attachmentTarget,
  type AttachmentTarget,
  type BoardAttachment,
  type ChatAttachment,
  type ReferenceAttachment,
} from "@/lib/agent/shared/attachments";
import { shownAs, type Discarded } from "@/lib/agent/shared/chat-log";
import { BoardPreview } from "./board-preview";

/// What the assistant put in front of the user, under the words that were
/// about it. A row of thumbnails rather than a list of titles: the whole point
/// of showing a reference is that the picture answers faster than its name, and
/// the sidebar is too narrow for more than a strip.
///
/// A board is drawn as a wider tile than a photograph, and says so on its face.
/// It is not one of the pictures — it is the thing the pictures were put into,
/// and clicking it leaves the gallery entirely, so it should not be mistaken for
/// another reference on the way to being clicked. What it shows is the
/// arrangement itself, drawn from the placements, and it falls back to the
/// opening slot's photograph only for a board with nothing placed on it.
///
/// A picture offered for removal is drawn wide for the opposite reason: it is
/// not one of the project's pictures but a decision about one, and the line
/// under it is what the decision is made on.
export function ShownResults({
  attachments,
  discarded,
  onOpen,
  onDiscard,
  onDiscardPage,
  onDiscardReference,
}: {
  attachments: ChatAttachment[];
  discarded: Discarded;
  onOpen: (target: AttachmentTarget) => void;
  onDiscard: (board: BoardAttachment) => Promise<void>;
  onDiscardPage: (board: BoardAttachment) => Promise<void>;
  onDiscardReference: (reference: ReferenceAttachment) => Promise<void>;
}) {
  /// Which board is on its way out, and which one would not go. Local to the
  /// strip because both are about a button that is on screen: the conversation
  /// records the discard that *happened*, and a delete that failed is not one.
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /// One handler for both kinds, keyed on the id of whatever is going: a board
  /// and a picture are two doors onto the same act, and two copies of the
  /// in-flight/failed pair would be two ways for that act to be reported.
  async function discard(id: string, remove: () => Promise<void>) {
    setDiscarding(id);
    setFailed(null);
    try {
      await remove();
    } catch {
      setFailed(id);
    } finally {
      setDiscarding(null);
    }
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((shown) => {
        const { attachment, gone } = shownAs(discarded, shown);
        const wide = attachment.kind !== "reference" || !!attachment.discard || !!gone;
        /// A discarded board is still drawn — it is under a reply that was about
        /// it — but it is no longer a way in: the tab row falls back to the first
        /// board for an id it does not hold, so a click would open somebody
        /// else's arrangement and read as the discard having failed.
        const Tile = gone ? "span" : "button";
        return (
          <li key={attachmentKey(shown)} className={wide ? "w-full" : ""}>
            <Tile
              {...(gone
                ? { "aria-disabled": true }
                : {
                    type: "button" as const,
                    onClick: () => onOpen(attachmentTarget(attachment)),
                  })}
              title={attachment.caption || attachment.title}
              className={`flex flex-col gap-1 rounded-lg border p-1 text-left transition-opacity ${
                gone ? "opacity-50" : "hover:opacity-70"
              } ${wide ? "w-full border-current/30" : "w-24 border-current/10"}`}
            >
              {attachment.kind === "board" && attachment.preview ? (
                <BoardPreview preview={attachment.preview} />
              ) : attachment.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.thumbUrl}
                  alt={attachment.title}
                  className={`w-full rounded object-cover ${wide ? "h-24" : "h-16"}`}
                />
              ) : (
                <span className="grid h-24 w-full place-items-center rounded border border-dashed border-current/20 text-[11px] opacity-50">
                  No preview yet
                </span>
              )}
              {wide ? (
                <span className="truncate text-xs font-medium">{attachment.title}</span>
              ) : null}
              {attachment.kind === "board" && attachment.lines.length ? (
                /// What the board says, beside the arrangement rather than in
                /// it: a headline is a few pixels tall in the miniature, so a
                /// reply about the words would otherwise be illustrated by a
                /// grey bar.
                <span className="flex flex-col text-[11px] leading-tight opacity-60">
                  {attachment.lines.map((line, index) => (
                    <span key={index} className="truncate">
                      “{line}”
                    </span>
                  ))}
                  {attachment.linesOver ? (
                    <span className="truncate">+{attachment.linesOver} more</span>
                  ) : null}
                </span>
              ) : null}
              <span className="truncate text-[11px] opacity-70">
                {attachment.kind === "board"
                  ? `${gone ? "Discarded" : attachment.discard ? (attachment.discardPage ? "Discard page?" : "Discard?") : "Moodboard"} · ${attachment.caption}`
                  : gone
                    ? `Removed · ${attachment.caption || attachment.title}`
                    : attachment.discard
                      ? `Remove? · ${attachment.caption || attachment.title}`
                      : attachment.caption || attachment.title}
              </span>
            </Tile>
            {/* The one act in this project nothing can undo, so it is a button
                under the board rather than something a tool did. Outside the
                tile because the tile is itself a button — the board is still
                openable while the question is up, which is most of how it gets
                answered. */}
            {attachment.kind === "board" && attachment.discard && !gone ? (
              <span className="flex items-center gap-2 px-1 pt-1 text-[11px]">
                <button
                  type="button"
                  disabled={discarding === attachment.boardId}
                  onClick={() =>
                    void discard(attachment.boardId, () =>
                      attachment.discardPage ? onDiscardPage(attachment) : onDiscard(attachment),
                    )
                  }
                  className="rounded-full border border-current/25 px-2 py-0.5 hover:bg-current/10 disabled:opacity-40"
                >
                  {discarding === attachment.boardId
                    ? "Discarding…"
                    : attachment.discardPage
                      ? "Discard page"
                      : "Discard board"}
                </button>
                <span className="opacity-50">
                  {failed === attachment.boardId
                    ? "Could not discard — try again."
                    : attachment.discardPage
                      ? "Cannot be undone. The board's other pages stay, and the photographs stay in the gallery."
                      : "Cannot be undone. The photographs stay in the gallery."}
                </span>
              </span>
            ) : null}
            {/* The same button one kind over, and the sentence beside it is
                doing more work: a picture takes its cuts with it and leaves a
                hole in every board it was on, none of which is visible from the
                tile. */}
            {attachment.kind === "reference" && attachment.discard && !gone ? (
              <span className="flex items-center gap-2 px-1 pt-1 text-[11px]">
                <button
                  type="button"
                  disabled={discarding === attachment.referenceId}
                  onClick={() =>
                    void discard(attachment.referenceId, () => onDiscardReference(attachment))
                  }
                  className="rounded-full border border-current/25 px-2 py-0.5 hover:bg-current/10 disabled:opacity-40"
                >
                  {discarding === attachment.referenceId ? "Removing…" : "Remove picture"}
                </button>
                <span className="opacity-50">
                  {failed === attachment.referenceId
                    ? "Could not remove — try again."
                    : removalCost(attachment.discard)}
                </span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/// What the user is told they are about to lose, beside the button. The
/// cuts and the boards are the two halves of it the tile cannot show — a crop
/// made an hour ago is a row in another panel, and a board is a whole other
/// column.
function removalCost({ cuts, boards }: { cuts: number; boards: readonly unknown[] }) {
  const parts = [
    cuts ? `${cuts} ${cuts === 1 ? "crop" : "crops"} of it go too` : null,
    boards.length
      ? `${boards.length} ${boards.length === 1 ? "board" : "boards"} lose a picture`
      : null,
  ].filter(Boolean);
  return parts.length ? `Cannot be undone. ${parts.join(", ")}.` : "Cannot be undone.";
}
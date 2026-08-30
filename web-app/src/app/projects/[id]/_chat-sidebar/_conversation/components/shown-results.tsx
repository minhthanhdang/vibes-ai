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
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

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

function removalCost({ cuts, boards }: { cuts: number; boards: readonly unknown[] }) {
  const parts = [
    cuts ? `${cuts} ${cuts === 1 ? "crop" : "crops"} of it go too` : null,
    boards.length
      ? `${boards.length} ${boards.length === 1 ? "board" : "boards"} lose a picture`
      : null,
  ].filter(Boolean);
  return parts.length ? `Cannot be undone. ${parts.join(", ")}.` : "Cannot be undone.";
}
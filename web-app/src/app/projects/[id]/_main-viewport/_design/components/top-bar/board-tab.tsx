"use client";

import { useRef, useState } from "react";
import { BOARD_TITLE_LIMIT, normalizedBoardTitle } from "@/lib/scene/moodboard-boards";
import type { Board } from "../../types";

/// A tab is the board's name, its rename field and its delete confirmation in
/// one place — the boards live in a single scrolling row, so a menu or a modal
/// would be more chrome than the row itself.
export function BoardTab({
  board,
  isActive,
  onOpen,
  onRename,
  onDuplicate,
  onRemove,
}: {
  board: Board;
  isActive: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  /// A blur commits, and Enter blurs — so without this the commit runs twice,
  /// the second time against a draft the first already cleared.
  const committed = useRef(false);

  function startRename() {
    setConfirmingRemoval(false);
    committed.current = false;
    setDraft(board.title);
  }

  function commitRename() {
    if (committed.current || draft === null) return;
    committed.current = true;
    const title = normalizedBoardTitle(draft);
    setDraft(null);
    if (title && title !== board.title) onRename(title);
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={BOARD_TITLE_LIMIT}
        aria-label={`Rename ${board.title}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitRename}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            committed.current = true;
            setDraft(null);
          }
        }}
        className="w-40 shrink-0 rounded-full border border-current/40 bg-transparent px-3 py-1 text-xs outline-none"
      />
    );
  }

  if (confirmingRemoval) {
    return (
      <span className="flex shrink-0 items-center gap-2 rounded-full border border-current/40 px-3 py-1 text-xs">
        Delete “{board.title}”?
        <button type="button" onClick={onRemove} className="font-medium underline">
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirmingRemoval(false)}
          className="opacity-60 underline hover:opacity-100"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center rounded-full border transition-opacity ${
        isActive ? "border-current/40 font-medium" : "border-current/15 opacity-60 hover:opacity-100"
      }`}
    >
      {/* Double-click renames rather than a nested pencil button: a button
          inside a button is invalid markup and swallows the click. */}
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={startRename}
        aria-current={isActive}
        className="flex max-w-56 items-center gap-2 py-1 pr-1 pl-1.5 text-xs"
      >
        {/* What the board looks like, at the size a tab has room for. Boards are
            named in a hurry and renamed rarely; the picture is what the user
            actually recognises one by. Absent until the board has been rendered,
            which an empty board never is. */}
        {board.renderUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={board.renderUrl}
            alt=""
            loading="lazy"
            className="h-5 w-8 shrink-0 rounded-sm bg-current/5 object-cover"
          />
        ) : (
          <span className="h-5 w-8 shrink-0 rounded-sm border border-dashed border-current/20" />
        )}
        <span className="truncate">{board.title}</span>
      </button>

      {isActive ? (
        <>
          <button
            type="button"
            onClick={startRename}
            aria-label={`Rename ${board.title}`}
            title="Rename"
            className="px-1 py-1 text-xs opacity-60 hover:opacity-100"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            aria-label={`Duplicate ${board.title}`}
            title="Duplicate board"
            className="px-1 py-1 text-xs opacity-60 hover:opacity-100"
          >
            ⧉
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemoval(true)}
            aria-label={`Delete ${board.title}`}
            title="Delete board"
            className="py-1 pr-3 pl-1 text-xs opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </>
      ) : (
        <span className="pr-3" />
      )}
    </span>
  );
}
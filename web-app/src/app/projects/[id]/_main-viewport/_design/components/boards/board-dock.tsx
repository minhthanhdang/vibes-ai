"use client";

import { useEffect, useRef, useState } from "react";
/// The boards, floating over the board they switch between.
///
/// A row of tabs above the canvas costs its height on every project forever to
/// answer a question — which board is this — that one word answers. So the dock
/// says that one word until it is reached for, and opens into the full row on
/// hover or on focus.
///
/// It expands rather than swaps: the toggle stays mounted through the change,
/// which is what lets a keyboard reach the tabs at all. Tab to it, it opens
/// under the focus, and the next Tab is already inside.
export function BoardDock({
  activeTitle,
  children,
}: {
  /// What the collapsed dock says. Null while the project has no boards, when
  /// there is nothing to name and the row is one "New board" button.
  activeTitle: string | null;
  /// The tabs and the way to start another — shown once the dock is open.
  children: React.ReactNode;
}) {
  const dock = useRef<HTMLDivElement>(null);
  /// The pointer's own answer, because `:hover` is not readable and a
  /// `pointerleave` fired while a tab holds focus must not close anything.
  const isPointerInside = useRef(false);
  const [isOpen, setOpen] = useState(false);

  function releaseIfDone() {
    if (isPointerInside.current) return;
    if (dock.current?.contains(document.activeElement)) return;
    setOpen(false);
  }

  /// The other way out. Leaving and blurring cover the dock being finished with,
  /// but not every way a tab stops holding focus: cancelling a rename unmounts
  /// the field, and React fires no blur for a node that is already gone — so the
  /// dock would stay open over a canvas the pointer left long ago. A press
  /// anywhere else is the unambiguous "done with this".
  useEffect(() => {
    if (!isOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!dock.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [isOpen]);

  return (
    <div
      ref={dock}
      onPointerEnter={() => {
        isPointerInside.current = true;
        setOpen(true);
      }}
      onPointerLeave={() => {
        isPointerInside.current = false;
        releaseIfDone();
      }}
      onFocus={() => setOpen(true)}
      /// React's `onBlur` is focusout, so it carries where focus went. Reading
      /// `document.activeElement` here would read the body: the new element is
      /// not focused yet.
      onBlur={(event) => {
        if (!dock.current?.contains(event.relatedTarget)) releaseIfDone();
      }}
      /// The right end of the editor's own bottom row, whose zoom, history and
      /// help controls are pulled to the left end and given this shape
      /// (`excalidraw-chrome.css`) — one line of controls across the foot of the
      /// board rather than two.
      ///
      /// The reserve is what the dock may not grow into. A board with many pages
      /// scrolls its tabs inside that width instead of opening across the
      /// controls at the other end.
      className="absolute right-4 bottom-4 z-20 flex h-10 max-w-[calc(100%-19rem)] items-center gap-2 rounded-full border border-current/15 bg-[var(--background)]/80 px-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => setOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Hide boards" : "Show boards"}
        className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors hover:bg-current/10"
      >
        <span className="opacity-40">{isOpen ? "▾" : "▸"}</span>
        {isOpen ? null : <span className="truncate">{activeTitle ?? "No boards"}</span>}
      </button>

      {isOpen ? children : null}
    </div>
  );
}

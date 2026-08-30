"use client";

import { useEffect, useRef, useState } from "react";
export function BoardDock({
  activeTitle,
  children,
}: {
  activeTitle: string | null;
  children: React.ReactNode;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const isPointerInside = useRef(false);
  const [isOpen, setOpen] = useState(false);

  function releaseIfDone() {
    if (isPointerInside.current) return;
    if (dock.current?.contains(document.activeElement)) return;
    setOpen(false);
  }

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
      onBlur={(event) => {
        if (!dock.current?.contains(event.relatedTarget)) releaseIfDone();
      }}
      className={
        isOpen
          ? "absolute right-4 bottom-4 z-20 flex max-h-[60%] w-max max-w-80 flex-col-reverse gap-1.5 rounded-xl border border-current/15 bg-[var(--background)]/80 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-md"
          : "absolute right-4 bottom-4 z-20 flex h-10 max-w-[calc(100%-19rem)] items-center gap-2 rounded-full border border-current/15 bg-[var(--background)]/80 px-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-md"
      }
    >
      <button
        type="button"
        onClick={() => setOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Hide boards" : "Show boards"}
        className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors hover:bg-current/10"
      >
        <span className="opacity-40">{isOpen ? "▴" : "▸"}</span>
        {isOpen ? null : <span className="truncate">{activeTitle ?? "No boards"}</span>}
      </button>

      {isOpen ? children : null}
    </div>
  );
}

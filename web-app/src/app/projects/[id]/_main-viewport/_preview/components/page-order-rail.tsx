"use client";

import { useRef, useState } from "react";
import { dragSeat } from "@/lib/pages/page-order";
import type { BoardPage } from "@/lib/pages/board-pages";

/// The reorder rail (PRD §III.6): one numbered thumbnail per page in preview
/// order, floating over the carousel's left edge. Reordering is the up/down
/// buttons — the keyboard and a11y path — or a hand-rolled pointer drag: down
/// arms, moving past a slop lifts the row (a transform, so nothing reflows),
/// `dragSeat`'s midpoint hit-test names the seat, up commits. No dnd library:
/// HTML5 drag-and-drop's ergonomics are poor for a vertical list, and the house
/// pattern is hand-rolled strips.
///
/// The commit is the caller's `onMove`, which writes the *full* order (§III.5)
/// optimistically — so the rail and the main carousel reorder on the click, not
/// on the round trip.

const DRAG_SLOP_PX = 5;

type Drag = {
  from: number;
  startY: number;
  dy: number;
  lifted: boolean;
  /// Measured once at pointerdown: only the lifted row moves, so the resting
  /// rows' midpoints hold still for the whole drag.
  midpoints: number[];
  seat: number;
};

export function PageOrderRail({
  pages,
  thumbs,
  currentIndex,
  onSeek,
  onMove,
}: {
  pages: readonly BoardPage[];
  thumbs: Readonly<Record<string, string>>;
  currentIndex: number;
  onSeek: (index: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  function rowMidpoints(): number[] {
    const rows = rail.current?.querySelectorAll("[data-seat]") ?? [];
    return [...rows].map((row) => {
      const seat = row.getBoundingClientRect();
      return seat.top + seat.height / 2;
    });
  }

  const lifted = drag?.lifted ? drag : null;

  return (
    <div
      ref={rail}
      className="absolute top-1/2 left-3 z-10 flex max-h-[85%] -translate-y-1/2 flex-col gap-1.5 overflow-y-auto rounded-xl border border-current/10 bg-[var(--background)]/80 p-1.5 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {pages.map((page, at) => (
        <div
          key={page.id}
          data-seat={at}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            /// The buttons reorder on their own click; a press on one must not
            /// also arm a drag of the row it sits in.
            if ((event.target as HTMLElement).closest("button")) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({
              from: at,
              startY: event.clientY,
              dy: 0,
              lifted: false,
              midpoints: rowMidpoints(),
              seat: at,
            });
          }}
          onPointerMove={(event) => {
            if (!drag || drag.from !== at) return;
            const dy = event.clientY - drag.startY;
            setDrag({
              ...drag,
              dy,
              lifted: drag.lifted || Math.abs(dy) > DRAG_SLOP_PX,
              seat: dragSeat(drag.midpoints, drag.from, event.clientY),
            });
          }}
          onPointerUp={() => {
            if (!drag || drag.from !== at) return;
            if (!drag.lifted) onSeek(at);
            else if (drag.seat !== drag.from) onMove(drag.from, drag.seat);
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
          style={lifted?.from === at ? { transform: `translateY(${lifted.dy}px)` } : undefined}
          className={`flex shrink-0 cursor-grab touch-none items-center gap-1.5 rounded-lg border p-1 select-none ${
            lifted?.from === at
              ? "z-10 cursor-grabbing border-current/40 opacity-90 shadow-lg"
              : lifted && lifted.seat === at
                ? "border-current/50"
                : at === currentIndex
                  ? "border-current/40"
                  : "border-current/10 opacity-80 hover:opacity-100"
          }`}
        >
          <span className="w-4 text-center text-[10px] opacity-60 tabular-nums">{at + 1}</span>
          <span className="flex h-11 w-16 items-center justify-center overflow-hidden rounded bg-current/5">
            {thumbs[page.id] ? (
              /* An object URL, like every bitmap here — no next/image loader. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbs[page.id]}
                alt={page.name || `Page ${at + 1}`}
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-[9px] opacity-40">…</span>
            )}
          </span>
          <span className="flex flex-col">
            <button
              type="button"
              onClick={() => onMove(at, at - 1)}
              disabled={at === 0}
              aria-label={`Move page ${at + 1} up`}
              className="rounded px-1 text-[10px] opacity-70 hover:bg-current/10 hover:opacity-100 disabled:opacity-20"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMove(at, at + 1)}
              disabled={at === pages.length - 1}
              aria-label={`Move page ${at + 1} down`}
              className="rounded px-1 text-[10px] opacity-70 hover:bg-current/10 hover:opacity-100 disabled:opacity-20"
            >
              ↓
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

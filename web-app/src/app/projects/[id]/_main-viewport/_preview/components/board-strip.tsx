"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { boardPages } from "@/lib/pages/board-pages";
import { orderedPages } from "@/lib/pages/page-order";
import { pageBitmapUrl, PREVIEW_THUMB_MAX_DIMENSION } from "../utils/page-bitmap";
import type { Board } from "../../_design/types";

/// The board picker at the bottom of the Preview tab (PRD §III.4): a
/// slide-carousel strip of cards, title over a first-page thumbnail. Boards
/// arrive `createdAt asc` off `moodboard.listByProject` — the same order as
/// Design's tab row, so the two views agree about "next board".
export function BoardStrip({
  boards,
  activeId,
  onOpen,
}: {
  boards: readonly Board[] | undefined;
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  /// The wheel-to-horizontal translation `board-tabs.tsx` carries, for the same
  /// reason: a mouse has one wheel and it points the wrong way for a row.
  useEffect(() => {
    const strip = row.current;
    if (!strip) return;

    const turnSideways = (event: WheelEvent) => {
      if (event.deltaX !== 0) return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };

    strip.addEventListener("wheel", turnSideways, { passive: false });
    return () => strip.removeEventListener("wheel", turnSideways);
  }, []);

  /// The selected card nudged into view, `board-tabs.tsx`'s pattern: opening
  /// Preview on a board scrolled out of the strip would show a row with nothing
  /// in it marked current.
  useEffect(() => {
    const strip = row.current;
    const card = strip?.querySelector('[aria-current="true"]');
    if (!strip || !card) return;

    const edge = strip.getBoundingClientRect();
    const seat = card.getBoundingClientRect();
    const margin = 12;
    if (seat.left < edge.left) strip.scrollLeft -= edge.left - seat.left + margin;
    else if (seat.right > edge.right) strip.scrollLeft += seat.right - edge.right + margin;
  }, [activeId, boards]);

  if (!boards?.length) return null;

  return (
    <div
      ref={row}
      className="flex shrink-0 snap-x items-stretch gap-3 overflow-x-auto border-t border-current/10 px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {boards.map((board) => (
        <BoardCard
          key={board.id}
          board={board}
          isActive={board.id === activeId}
          onOpen={() => onOpen(board.id)}
        />
      ))}
    </div>
  );
}

/// One card. Its thumbnail is the first page *in preview order* of the board's
/// stored scene, exported on this card's own scene fetch — started only once
/// the card has scrolled into view, so a project of many boards pays for the
/// strip a card at a time.
function BoardCard({
  board,
  isActive,
  onOpen,
}: {
  board: Board;
  isActive: boolean;
  onOpen: () => void;
}) {
  const trpc = useTRPC();
  const card = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    const node = card.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setSeen(true);
      observer.disconnect();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { data: scene } = useQuery(
    trpc.moodboard.scene.queryOptions(
      { id: board.id },
      /// A thumbnail may be a save behind the canvas; the open board's own
      /// carousel re-reads on mount (`preview-view.tsx`), and whenever it does,
      /// this card shares the freshened cache entry.
      { enabled: seen, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
    ),
  );

  useEffect(() => {
    if (!scene) return;
    let cancelled = false;
    let made: string | null = null;
    void (async () => {
      const first = orderedPages(boardPages(scene.elements), scene.previewOrder)[0];
      if (!first) return;
      const url = await pageBitmapUrl(scene, first, PREVIEW_THUMB_MAX_DIMENSION);
      if (!url) return;
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      made = url;
      setThumb(url);
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [scene]);

  return (
    <button
      ref={card}
      type="button"
      onClick={onOpen}
      aria-current={isActive}
      className={`flex w-40 shrink-0 snap-start flex-col gap-1.5 rounded-xl border p-2 text-left transition-opacity ${
        isActive ? "border-current/40" : "border-current/15 opacity-70 hover:opacity-100"
      }`}
    >
      <span className="flex h-20 w-full items-center justify-center overflow-hidden rounded-md bg-current/5">
        {thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={thumb} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] opacity-40">
            {scene && boardPages(scene.elements).length === 0 ? "No pages" : "…"}
          </span>
        )}
      </span>
      <span className="truncate text-xs">{board.title}</span>
    </button>
  );
}

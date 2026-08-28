"use client";

import { useEffect, useRef, useState } from "react";
import { usePageBitmaps } from "../hooks/use-page-bitmaps";
import { PageOrderRail } from "./page-order-rail";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

/// One board's pages as full-width slides (PRD §III.3). Hand-rolled on CSS
/// scroll-snap — nothing is installed for carousels and the house pattern is
/// hand-rolled strips (`board-tabs.tsx`); a dependency for scroll-snap is not
/// worth its weight.
///
/// The slides are in *preview* order, not reading order — the caller hands the
/// list already ordered (`orderedPages`, §III.5).
///
/// Clicking a slide is deliberately inert: a later door could jump to Design on
/// that page, but that is not in scope, and a half-meaning click is worse than
/// none.
export function PageCarousel({
  scene,
  pages,
  onReorder,
}: {
  scene: MoodboardScene;
  pages: readonly BoardPage[];
  /// The rail's commit (§III.6): move the page at one seat to another, in
  /// preview order. The caller owns the write and its optimistic patch.
  onReorder: (from: number, to: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const { slides, thumbs } = usePageBitmaps({ scene, pages, currentIndex: index });

  const count = pages.length;
  /// Never past the end: a page deleted under the carousel shortens the list,
  /// and "4 / 3" is a caption about a slide that is not there.
  const shown = Math.min(index, count - 1);

  /// Which slide is being looked at, observed off the scroll itself rather than
  /// computed from arrow presses — the strip also moves by trackpad and by
  /// drag, and `scrollend` is not everywhere yet.
  useEffect(() => {
    const root = strip.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const at = Number((entry.target as HTMLElement).dataset.index);
          if (Number.isInteger(at)) setIndex(at);
        }
      },
      { root, threshold: 0.6 },
    );
    for (const slide of root.children) observer.observe(slide);
    return () => observer.disconnect();
  }, [count]);

  /// Slides are exactly the strip's width, so a neighbour is one strip-width
  /// away and the snap finishes whatever the smooth scroll leaves off.
  function goTo(at: number) {
    const root = strip.current;
    if (!root) return;
    const target = Math.max(0, Math.min(count - 1, at));
    root.scrollTo({ left: target * root.clientWidth, behavior: "smooth" });
  }

  return (
    <div
      /// Focusable so ←/→ page through while the view has focus; the outline is
      /// dropped because the whole viewport lighting up on click reads as a
      /// selection, not a focus.
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        goTo(shown + (event.key === "ArrowLeft" ? -1 : 1));
      }}
      className="relative h-full w-full outline-none"
    >
      <div
        ref={strip}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((page, at) => (
          <div
            key={page.id}
            data-index={at}
            className="flex h-full w-full shrink-0 snap-center items-center justify-center p-6"
          >
            {slides[page.id] ? (
              /* An object URL, which next/image has no loader for — the same
                 reason every bitmap in this app is an <img>. Letterboxed by
                 object-contain, so portrait and landscape presets both fit. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slides[page.id]}
                alt={page.name || `Page ${at + 1}`}
                className="max-h-full max-w-full rounded-sm object-contain shadow-[0_4px_24px_rgba(0,0,0,0.18)]"
              />
            ) : (
              <span className="text-sm opacity-50">Drawing page…</span>
            )}
          </div>
        ))}
      </div>

      {/* A one-page board has nothing to reorder and nowhere to seek. */}
      {count > 1 ? (
        <PageOrderRail
          pages={pages}
          thumbs={thumbs}
          currentIndex={shown}
          onSeek={goTo}
          onMove={onReorder}
        />
      ) : null}

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => goTo(shown - 1)}
            disabled={shown === 0}
            aria-label="Previous page"
            /* Bottom corners rather than mid-height flanks: the rail (§III.6)
               floats over the left edge, and an arrow under it is an arrow
               that cannot be pressed. */
            className="absolute bottom-3 left-3 rounded-full border border-current/15 bg-[var(--background)]/80 px-2.5 py-1.5 text-sm backdrop-blur-md transition-opacity hover:opacity-100 disabled:opacity-30"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => goTo(shown + 1)}
            disabled={shown === count - 1}
            aria-label="Next page"
            className="absolute right-3 bottom-3 rounded-full border border-current/15 bg-[var(--background)]/80 px-2.5 py-1.5 text-sm backdrop-blur-md transition-opacity hover:opacity-100 disabled:opacity-30"
          >
            →
          </button>
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-current/15 bg-[var(--background)]/80 px-2.5 py-0.5 text-xs backdrop-blur-md">
            {shown + 1} / {count}
          </span>
        </>
      ) : null}
    </div>
  );
}

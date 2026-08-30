"use client";

import { useEffect, useRef, useState } from "react";
import { usePageBitmaps } from "../hooks/use-page-bitmaps";
import { PageOrderRail } from "./page-order-rail";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

export function PageCarousel({
  scene,
  pages,
  onReorder,
}: {
  scene: MoodboardScene;
  pages: readonly BoardPage[];
  onReorder: (from: number, to: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const { slides, thumbs } = usePageBitmaps({ scene, pages, currentIndex: index });

  const count = pages.length;
  const shown = Math.min(index, count - 1);

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

  function goTo(at: number) {
    const root = strip.current;
    if (!root) return;
    const target = Math.max(0, Math.min(count - 1, at));
    root.scrollTo({ left: target * root.clientWidth, behavior: "smooth" });
  }

  return (
    <div
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

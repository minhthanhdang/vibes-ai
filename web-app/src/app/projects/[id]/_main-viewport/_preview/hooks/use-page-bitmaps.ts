"use client";

import { useEffect, useRef, useState } from "react";
import {
  pageBitmapUrl,
  PREVIEW_SLIDE_MAX_DIMENSION,
  PREVIEW_THUMB_MAX_DIMENSION,
} from "../utils/page-bitmap";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

type BitmapKind = "slide" | "thumb";

export function usePageBitmaps({
  scene,
  pages,
  currentIndex,
}: {
  scene: MoodboardScene | undefined;
  pages: readonly BoardPage[];
  currentIndex: number;
}): { slides: Readonly<Record<string, string>>; thumbs: Readonly<Record<string, string>> } {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  const made = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    const cache = made.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  useEffect(() => {
    if (!scene || pages.length === 0) return;
    const tag = `${scene.id}:${scene.revision}`;
    let cancelled = false;

    for (const [key, url] of made.current) {
      if (key.startsWith(`${tag}:`)) continue;
      URL.revokeObjectURL(url);
      made.current.delete(key);
    }

    const byDistance = pages
      .map((page, index) => ({ page, distance: Math.abs(index - currentIndex) }))
      .sort((a, b) => a.distance - b.distance)
      .map(({ page }) => page);
    const jobs: { page: BoardPage; kind: BitmapKind }[] = [
      ...byDistance.map((page) => ({ page, kind: "slide" as const })),
      ...byDistance.map((page) => ({ page, kind: "thumb" as const })),
    ];

    void (async () => {
      for (const { page, kind } of jobs) {
        if (cancelled) return;
        const key = `${tag}:${kind}:${page.id}`;
        if (made.current.has(key) || inFlight.current.has(key)) continue;
        inFlight.current.add(key);
        try {
          const url = await pageBitmapUrl(
            scene,
            page,
            kind === "slide" ? PREVIEW_SLIDE_MAX_DIMENSION : PREVIEW_THUMB_MAX_DIMENSION,
          );
          if (!url) continue;
          made.current.set(key, url);
          setUrls((current) => {
            const kept: Record<string, string> = { [key]: url };
            for (const [held, heldUrl] of Object.entries(current)) {
              if (held.startsWith(`${tag}:`)) kept[held] = heldUrl;
            }
            return kept;
          });
        } finally {
          inFlight.current.delete(key);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scene, pages, currentIndex]);

  const tag = scene ? `${scene.id}:${scene.revision}` : null;
  return { slides: ofKind(urls, tag, "slide"), thumbs: ofKind(urls, tag, "thumb") };
}

function ofKind(
  urls: Readonly<Record<string, string>>,
  tag: string | null,
  kind: BitmapKind,
): Record<string, string> {
  if (!tag) return {};
  const lead = `${tag}:${kind}:`;
  const picked: Record<string, string> = {};
  for (const [key, url] of Object.entries(urls)) {
    if (key.startsWith(lead)) picked[key.slice(lead.length)] = url;
  }
  return picked;
}

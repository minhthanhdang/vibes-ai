"use client";

import { useEffect, useRef, useState } from "react";
import {
  pageBitmapUrl,
  PREVIEW_SLIDE_MAX_DIMENSION,
  PREVIEW_THUMB_MAX_DIMENSION,
} from "../utils/page-bitmap";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

/// The carousel's bitmaps, exported lazily and cached per revision (PRD
/// §III.2). Exports run one at a time — each is a full canvas draw — ordered by
/// distance from the slide being looked at, all the big slides before any
/// thumbnail: the picture on screen first, its neighbours next, the rail's
/// miniatures last. A re-render mid-scroll only reorders what is left; nothing
/// already drawn is drawn again, because the cache is keyed on
/// `(board, revision, page, size)` and a new revision is the one thing that
/// starts the map over.

type BitmapKind = "slide" | "thumb";

export function usePageBitmaps({
  scene,
  pages,
  currentIndex,
}: {
  scene: MoodboardScene | undefined;
  /// In the order the carousel shows them — memoised by the caller, since this
  /// effect keys on the array.
  pages: readonly BoardPage[];
  currentIndex: number;
}): { slides: Readonly<Record<string, string>>; thumbs: Readonly<Record<string, string>> } {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  /// The object URLs this hook has made and not yet revoked, keyed the same as
  /// `urls`. A ref beside the state because revocation happens in cleanups and
  /// async tails, where reading the state would read a stale closure.
  const made = useRef(new Map<string, string>());
  /// Keys being exported right now, so two effect runs racing over the same
  /// page (the index moved mid-export) do not both spend a draw on it.
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

    /// Everything of another board or an older revision is dead the moment this
    /// runs: revoked here, and dropped from the lookup with the first bitmap
    /// the new scene lands.
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
          /// Kept even when this run was superseded mid-draw — the export is
          /// already paid for, and the newer run skips the key because of it.
          /// Only an unmount (the cleanup above) throws bitmaps away.
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

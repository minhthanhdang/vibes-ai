"use client";

import { pagesToPicture, type PagePicture } from "@/lib/pages/page-picture";
import type { PageChoice } from "@/lib/pages/page-attach";

let mounted: { boardId: string; take: (pageId: string) => Promise<PagePicture | null> } | null =
  null;

export function holdPageCamera(
  boardId: string,
  take: (pageId: string) => Promise<PagePicture | null>,
) {
  mounted = { boardId, take };
  return () => {
    if (mounted?.boardId === boardId) mounted = null;
  };
}

export async function picturesForPages(
  picked: readonly PageChoice[],
): Promise<PagePicture[]> {
  const camera = mounted;
  if (!camera) return [];

  const pictures: PagePicture[] = [];
  for (const page of pagesToPicture(picked, camera.boardId)) {
    try {
      const picture = await camera.take(page.pageId);
      if (picture) pictures.push(picture);
    } catch (cause) {
      console.error(`page ${page.pageId} render failed:`, cause);
    }
  }
  return pictures;
}

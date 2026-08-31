"use client";

import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import { canvasBlob, pageCanvas, PREVIEW_SLIDE_MAX_DIMENSION } from "../utils/page-bitmap";
import { ensureGoogleFontsFor } from "@/lib/scene/excalidraw-google-fonts";
import type { useTRPCClient } from "@/trpc/react";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

type TRPCClient = ReturnType<typeof useTRPCClient>;

export async function uploadPageRenders(
  scene: MoodboardScene,
  pages: readonly BoardPage[],
  client: TRPCClient,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const present = await client.moodboard.pageRendersPresent.query({ id: scene.id });
  if (present.revision !== scene.revision) {
    throw new Error("The board changed while exporting. Try again.");
  }

  const already = new Set(present.pageIds);
  const missing = pages.filter((page) => !already.has(page.id));
  if (missing.length === 0) return;

  await ensureGoogleFontsFor(scene.elements);

  for (const [index, page] of missing.entries()) {
    onProgress(index, missing.length);

    const canvas = await pageCanvas(scene, page, PREVIEW_SLIDE_MAX_DIMENSION);
    if (!canvas) continue;

    const blob = await canvasBlob(canvas, BOARD_RENDER_CONTENT_TYPE);
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error(`Page ${index + 1} could not be drawn.`);

    const { url, contentType } = await client.moodboard.pageRenderUploadUrl.mutate({
      id: scene.id,
      pageId: page.id,
      revision: scene.revision,
    });
    const put = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!put.ok) throw new Error(`Page render upload failed: ${put.status}`);
  }

  onProgress(missing.length, missing.length);
}

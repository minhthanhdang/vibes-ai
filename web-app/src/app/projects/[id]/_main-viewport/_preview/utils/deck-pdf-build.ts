"use client";

import { PDFDocument } from "pdf-lib";
import { ensureGoogleFontsFor } from "@/lib/scene/excalidraw-google-fonts";
import {
  DECK_PDF_JPEG_QUALITY,
  DECK_PDF_MAX_DIMENSION,
  deckPdfPageSize,
  type DeckPdfQuality,
} from "@/lib/decks/deck-pdf";
import { canvasBlob, pageCanvas } from "./page-bitmap";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

const JPEG = "image/jpeg";

export async function buildDeckPdf(
  scene: MoodboardScene,
  pages: readonly BoardPage[],
  quality: DeckPdfQuality,
  onProgress: (done: number, total: number) => void,
): Promise<Blob> {
  if (pages.length === 0) throw new Error("This board has no pages to export.");

  await ensureGoogleFontsFor(scene.elements);

  const pdf = await PDFDocument.create();
  pdf.setTitle(scene.title);

  for (const [index, page] of pages.entries()) {
    onProgress(index, pages.length);

    const canvas = await pageCanvas(scene, page, DECK_PDF_MAX_DIMENSION[quality]);
    if (!canvas) continue;

    const blob = await canvasBlob(canvas, JPEG, DECK_PDF_JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error(`Page ${index + 1} could not be drawn.`);

    const picture = await pdf.embedJpg(await blob.arrayBuffer());
    const { width, height } = deckPdfPageSize(page);
    pdf.addPage([width, height]).drawImage(picture, { x: 0, y: 0, width, height });
  }

  onProgress(pages.length, pages.length);
  if (pdf.getPageCount() === 0) throw new Error("None of this board's pages could be drawn.");

  return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}

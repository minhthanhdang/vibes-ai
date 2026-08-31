import { nameSlug } from "@/lib/scene/moodboard-export";

export const DECK_PDF_QUALITIES = ["screen", "print"] as const;

export type DeckPdfQuality = (typeof DECK_PDF_QUALITIES)[number];

export const DECK_PDF_MAX_DIMENSION: Record<DeckPdfQuality, number> = {
  screen: 1600,
  print: 3200,
};

export const DECK_PDF_QUALITY_LABELS: Record<DeckPdfQuality, string> = {
  screen: "Screen",
  print: "Print",
};

export const DECK_PDF_JPEG_QUALITY = 0.92;

export const DECK_PDF_MAX_POINTS = 14400;

export function deckPdfPageSize(page: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const width = drawable(page.width);
  const height = drawable(page.height);
  const shrink = Math.min(1, DECK_PDF_MAX_POINTS / Math.max(width, height));
  return { width: width * shrink, height: height * shrink };
}

function drawable(edge: unknown): number {
  return typeof edge === "number" && Number.isFinite(edge) && edge > 0 ? edge : 1;
}

export function deckPdfFileName(boardTitle: unknown): string {
  return `${nameSlug(boardTitle) || "moodboard"}.pdf`;
}

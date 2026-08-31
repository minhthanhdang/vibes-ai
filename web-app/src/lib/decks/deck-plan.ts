import {
  ANALYSIS_DIMENSIONS,
  analysisFields,
  normalizeHexColor,
  type AnalysisProperties,
} from "@/lib/analysis/analysis";
import { RENDER_BACKGROUND } from "@/lib/render/render-plan";
import type { BoardPage } from "@/lib/pages/board-pages";

export const SLIDES_PAGE_PT = { width: 720, height: 405 } as const;

export type PtRect = { x: number; y: number; width: number; height: number };

export type RgbColour = { red: number; green: number; blue: number };

export type DeckSlide = {
  pageId: string;
  name: string;
  background: RgbColour;
  image: PtRect;
  notes: string;
};

const PT_PRECISION = 1000;
const CHANNEL_PRECISION = 1_000_000;

function rounded(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}

function edge(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

export function fitCentred(
  page: { width: number; height: number },
  into: { width: number; height: number },
): PtRect {
  const scale = Math.min(into.width / edge(page.width), into.height / edge(page.height));
  const width = edge(page.width) * scale;
  const height = edge(page.height) * scale;
  return {
    x: rounded((into.width - width) / 2, PT_PRECISION),
    y: rounded((into.height - height) / 2, PT_PRECISION),
    width: rounded(width, PT_PRECISION),
    height: rounded(height, PT_PRECISION),
  };
}

export function rgbColour(hex: string | null): RgbColour {
  const digits = (normalizeHexColor(hex) ?? RENDER_BACKGROUND).slice(1);
  const channel = (at: number) =>
    rounded(Number.parseInt(digits.slice(at, at + 2), 16) / 255, CHANNEL_PRECISION);
  return { red: channel(0), green: channel(2), blue: channel(4) };
}

export function speakerNotes(analyses: readonly AnalysisProperties[]): string {
  return analyses
    .map(referenceBlock)
    .filter((block) => block.length > 0)
    .join("\n\n");
}

function referenceBlock(analysis: AnalysisProperties): string {
  const fields = analysisFields(analysis);
  const lines = ANALYSIS_DIMENSIONS.flatMap(({ key, label }) =>
    fields[key].length ? [`${label}: ${fields[key].join(", ")}`] : [],
  );
  const title = analysis.title.trim();
  if (title) lines.unshift(title);
  return lines.join("\n");
}

export function deckSlides(
  pages: readonly BoardPage[],
  background: string | null,
  analysesOf: (pageId: string) => readonly AnalysisProperties[],
): DeckSlide[] {
  const colour = rgbColour(background);
  return pages.map((page, index) => ({
    pageId: page.id,
    name: page.name.trim() || `Page ${index + 1}`,
    background: colour,
    image: fitCentred(page, SLIDES_PAGE_PT),
    notes: speakerNotes(analysesOf(page.id)),
  }));
}

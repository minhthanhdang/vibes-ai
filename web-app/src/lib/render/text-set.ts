import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";
import { LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { DEFAULT_SET, advance, type SetMetric } from "@/lib/render/font-set";

export function setWidth(text: string, fontSize: number, metric: SetMetric = DEFAULT_SET): number {
  let em = 0;
  for (const char of text) em += advance(char, metric);
  return em * fontSize;
}

export function wrapToWidth(
  text: string,
  width: number,
  fontSize: number,
  metric: SetMetric = DEFAULT_SET,
): string[] {
  return text
    .split("\n")
    .flatMap((paragraph) => wrapRun(paragraph, width, fontSize, metric));
}

function wrapRun(text: string, width: number, fontSize: number, metric: SetMetric): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (!(width > 0) || !(fontSize > 0)) return [words.join(" ")];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const joined = line ? `${line} ${word}` : word;
    if (line && setWidth(joined, fontSize, metric) > width) {
      lines.push(line);
      line = word;
      continue;
    }
    line = joined;
  }
  if (line) lines.push(line);
  return lines;
}

export function setsToItsBox(element: {
  autoResize?: unknown;
  width?: unknown;
  [key: string]: unknown;
}): boolean {
  return (
    element.autoResize === false &&
    typeof element.width === "number" &&
    Number.isFinite(element.width) &&
    element.width > 0
  );
}

export function typedWords(element: {
  originalText?: unknown;
  text?: unknown;
  [key: string]: unknown;
}): string {
  const typed = typeof element.originalText === "string" ? element.originalText : "";
  const drawn = typeof element.text === "string" ? element.text : "";
  return (typed || drawn).replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

export function drawnLines(element: { text?: unknown; [key: string]: unknown }): number {
  const drawn = typeof element.text === "string" ? element.text : "";
  return Math.max(1, drawn.split("\n").filter((line) => line.trim()).length);
}

export function blockHeight(lines: number, fontSize: number): number {
  return Math.round(Math.max(1, lines) * fontSize * TEXT_LINE_HEIGHT);
}

export function setBlock(
  words: string,
  width: number,
  fontSize: number,
  metric: SetMetric = DEFAULT_SET,
): { text: string; lines: number; height: number } {
  const lines = wrapToWidth(words, width, fontSize, metric);
  return {
    text: lines.join("\n"),
    lines: lines.length,
    height: blockHeight(lines.length, fontSize),
  };
}

export function flooredType(
  element: { type?: unknown; [key: string]: unknown },
  placement: { width: number; fontSize?: number },
  metric: SetMetric = DEFAULT_SET,
): { fontSize: number; height: number; text?: string } | null {
  const asked = placement.fontSize;
  if (asked === undefined || asked >= LAYOUT_TEXT_MIN_FONT) return null;
  if (element.type !== "text") return null;

  const boxed =
    setsToItsBox(element) && !(typeof element.containerId === "string" && element.containerId);
  if (!boxed) {
    return {
      fontSize: LAYOUT_TEXT_MIN_FONT,
      height: blockHeight(drawnLines(element), LAYOUT_TEXT_MIN_FONT),
    };
  }
  const block = setBlock(typedWords(element), placement.width, LAYOUT_TEXT_MIN_FONT, metric);
  return {
    fontSize: LAYOUT_TEXT_MIN_FONT,
    height: block.height,
    ...(block.text && { text: block.text }),
  };
}

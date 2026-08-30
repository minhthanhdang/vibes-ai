import type { Rect } from "@/lib/boards/board-contents";
import { boardPages, pageHolds, type BoardPage } from "@/lib/pages/board-pages";
import { renderFontOf } from "@/lib/render/render-plan";
import { setBlock, setsToItsBox } from "@/lib/render/text-set";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import { collapsed, lineKey } from "@/lib/util/text";

export type RewordRequest = { from: string; to: string };

export type RewordedLine = { from: string; to: string };

export type RewordResult = {
  elements: SceneElement[];
  reworded: RewordedLine[];
  notOnBoard: string[];
  unchanged: string[];
};


function textOf(element: SceneElement) {
  const drawn = typeof element.text === "string" ? element.text : "";
  return drawn || (typeof element.originalText === "string" ? element.originalText : "");
}

export function rewordOnBoard({
  elements,
  rewordings,
  onPage = null,
}: {
  elements: readonly SceneElement[];
  rewordings: readonly RewordRequest[];
  onPage?: BoardPage | null;
}): RewordResult {
  const next = [...elements];
  const reworded: RewordedLine[] = [];
  const notOnBoard: string[] = [];
  const unchanged: string[] = [];

  const used = new Set<number>();

  const pages = boardPages(elements);
  const onThePage = (element: SceneElement) => {
    if (!onPage) return true;
    const box = rectOf(element);
    return box !== null && pageHolds(pages, onPage, box);
  };

  for (const { from, to } of rewordings) {
    const wanted = lineKey(from);
    const said = collapsed(to);
    if (!wanted || !said) continue;

    const index = next.findIndex(
      (element, at) =>
        !used.has(at) &&
        element.type === "text" &&
        lineKey(textOf(element)) === wanted &&
        onThePage(element),
    );
    if (index < 0) {
      notOnBoard.push(collapsed(from));
      continue;
    }

    const element = next[index]!;
    if (collapsed(textOf(element)) === said) {
      used.add(index);
      unchanged.push(said);
      continue;
    }

    next[index] = { ...element, ...saidOn(element, said) };
    used.add(index);
    reworded.push({ from: collapsed(textOf(element)), to: said });
  }

  return { elements: next, reworded, notOnBoard, unchanged };
}

function saidOn(element: SceneElement, said: string): Record<string, unknown> {
  const fontSize = finite(element.fontSize);
  const width = finite(element.width);
  if (!setsToItsBox(element) || width === null || fontSize === null || fontSize <= 0) {
    return { text: said, originalText: said };
  }
  const block = setBlock(said, width, fontSize, renderFontOf(element).set);
  return {
    text: block.text || said,
    originalText: said,
    height: block.height,
  };
}

function rectOf(element: SceneElement): Rect | null {
  const x = finite(element.x);
  const y = finite(element.y);
  const width = finite(element.width);
  const height = finite(element.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

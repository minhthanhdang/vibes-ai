import type { BoardItem, Rect } from "@/lib/boards/board-contents";
import type { ReadableShape } from "@/lib/canvas-objects/object-read";
import { pageItems } from "@/lib/pages/board-pages";

export const PAGE_BLOCK_CAP = 24;

const TEXT_CLAMP = 120;

export type PageBox = [number, number, number, number];

type BlockBase = {
  box: PageBox;
  opacity?: number;
  z: number;
  clipped?: true;
};

export type PageBlock =
  | (BlockBase & {
      kind: "image";
      referenceId: string | null;
    })
  | (BlockBase & { kind: "text"; text: string; clamped?: true })
  | (BlockBase & {
      kind: "shape";
      shape: ReadableShape;
      fill: string;
      stroke: string;
    });

export type PageBlocks = {
  blocks: PageBlock[];
  omitted: number;
};

export const PAGE_BOX_SCALE = 1000;

function share(value: number, span: number): number {
  if (!(span > 0)) return 0;
  return Math.min(
    PAGE_BOX_SCALE,
    Math.max(0, Math.round((value / span) * PAGE_BOX_SCALE)),
  );
}

export function pageBoxOf(item: Rect, page: Rect): PageBox {
  return [
    share(item.y - page.y, page.height),
    share(item.x - page.x, page.width),
    share(item.y + item.height - page.y, page.height),
    share(item.x + item.width - page.x, page.width),
  ];
}

export function clampedText(text: string): { text: string; clamped?: true } {
  const said = text.trim();
  if (said.length <= TEXT_CLAMP) return { text: said };
  return { text: `${said.slice(0, TEXT_CLAMP).trimEnd()}…`, clamped: true as const };
}

export function blockReach(box: PageBox): number {
  return Math.max(box[2] - box[0], box[3] - box[1]);
}

export function byReach<T extends { box: PageBox }>(blocks: readonly T[]): number[] {
  return blocks
    .map((_, at) => at)
    .sort((one, other) => blockReach(blocks[other]!.box) - blockReach(blocks[one]!.box));
}

export function pageBlocks(
  items: readonly BoardItem[],
  page: Rect,
  { cap = PAGE_BLOCK_CAP }: { cap?: number } = {},
): PageBlocks {
  const on = pageItems(items, page).map((item): PageBlock => {
    const common = {
      box: pageBoxOf(item, page),
      z: item.z,
      ...(item.opacity !== undefined && item.opacity < 100 && { opacity: item.opacity }),
      ...(item.clipped && { clipped: true as const }),
    };
    if (item.kind === "image") {
      return { kind: "image" as const, referenceId: item.referenceId, ...common };
    }
    if (item.kind === "text") {
      return { kind: "text" as const, ...clampedText(item.text ?? ""), ...common };
    }
    const style = item.style!;
    return {
      kind: "shape" as const,
      shape: item.shape!,
      fill: style.fill,
      stroke: style.stroke,
      ...common,
    };
  });

  const kept =
    cap >= 0 && on.length > cap
      ? byReach(on)
          .slice(0, cap)
          .sort((one, other) => one - other)
          .map((at) => on[at]!)
      : on;

  return { blocks: kept, omitted: on.length - kept.length };
}

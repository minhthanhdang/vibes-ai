import { readableTarget } from "@/lib/canvas-objects/object-read";
import {
  PAGE_GROUND_INSTEAD,
  styleReading,
  type FontResolution,
  type StyleAsked,
  type StyleTarget,
} from "@/lib/canvas-objects/object-style";
import { boardPages, isFrameElement } from "@/lib/pages/board-pages";
import { renderFontOf } from "@/lib/render/render-plan";
import {
  blockHeight,
  drawnLines,
  setBlock,
  setsToItsBox,
  typedWords,
} from "@/lib/render/text-set";
import { isPageBackground } from "@/lib/pages/page-background";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type RestyleChange = { objectId: string } & StyleAsked;

export type RestyledObject = {
  objectId: string;
  set: (keyof StyleAsked)[];
  refused?: string[];
};

export type RestyleRefusal = { objectId: string; reason: string };

export type RestyleResult = {
  elements: SceneElement[] | null;
  restyled: RestyledObject[];
  unchanged: string[];
  notFound: string[];
  refused: RestyleRefusal[];
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sameColumn(column: string, current: unknown, asked: unknown): boolean {
  if (column === "roundness") {
    return Boolean(current) === Boolean(asked);
  }
  if (column === "customData") {
    const font = (value: unknown) => (value as { font?: unknown } | null)?.font ?? null;
    return JSON.stringify(font(current)) === JSON.stringify(font(asked));
  }
  if (typeof asked === "string" && typeof current === "string") {
    return current.trim().toLowerCase() === asked.trim().toLowerCase();
  }
  return current === asked;
}

export function restyleObjects(
  elements: readonly SceneElement[],
  changes: readonly RestyleChange[],
  fonts?: ReadonlyMap<string, FontResolution>,
): RestyleResult {
  const pageIds = new Set(boardPages(elements).map((page) => page.id));

  const live = new Map<string, SceneElement>();
  for (const element of elements) {
    if (element.isDeleted !== true && element.id) live.set(element.id, element);
  }

  const restyled: RestyledObject[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const refused: RestyleRefusal[] = [];
  const writes = new Map<string, Record<string, unknown>>();

  for (const change of changes) {
    const { objectId } = change;
    const refuse = (reason: string) => refused.push({ objectId, reason });

    if (writes.has(objectId) || restyled.some((done) => done.objectId === objectId)) {
      refuse("already restyled by an earlier change in this call");
      continue;
    }

    const element = live.get(objectId);
    if (!element) {
      notFound.push(objectId);
      continue;
    }

    if (pageIds.has(objectId)) {
      refuse(`a page takes no style fields — ${PAGE_GROUND_INSTEAD}`);
      continue;
    }
    if (isFrameElement(element)) {
      refuse(
        "a section takes no style fields — it is an arrangement of what is inside it, and a frame's own fill is drawn by neither the editor nor the export",
      );
      continue;
    }
    if (isPageBackground(element)) {
      refuse(
        "a page’s background is recoloured with set_page_background, not restyled — it is the page’s ground rather than a shape on it",
      );
      continue;
    }
    if (typeof element.containerId === "string" && element.containerId) {
      refuse(`a bound label is styled with its container — restyle ${element.containerId} instead`);
      continue;
    }

    const target = readableTarget(element);
    if (!target) {
      notFound.push(objectId);
      continue;
    }
    if (element.locked === true) {
      refuse("locked");
      continue;
    }

    const style = styleReading(target.kind as StyleTarget, change, target.shape ?? undefined, {
      resolved: fonts,
      element,
    });

    const patch: Record<string, unknown> = {};
    const set: (keyof StyleAsked)[] = [];
    for (const { field, writes: columns } of style.applied) {
      const moved = Object.entries(columns).filter(
        ([column, value]) => !sameColumn(column, element[column], value),
      );
      if (!moved.length) continue;
      for (const [column, value] of moved) patch[column] = value;
      set.push(field);
    }

    const typed = target.kind === "text";
    const size = typed ? (finite(patch.fontSize) ?? finite(element.fontSize)) : null;
    const family = typed && patch.fontFamily !== undefined;
    if (size !== null && (finite(patch.fontSize) !== null || family)) {
      if (setsToItsBox(element)) {
        const block = setBlock(
          typedWords(element),
          finite(element.width) ?? 0,
          size,
          renderFontOf({
            fontFamily: patch.fontFamily ?? element.fontFamily,
            customData: "customData" in patch ? patch.customData : element.customData,
          }).set,
        );
        patch.height = block.height;
        if (block.text) patch.text = block.text;
      } else {
        patch.height = blockHeight(drawnLines(element), size);
      }
    }

    if (!set.length) {
      if (style.refusals.length) refuse(style.refusals.join("; "));
      else unchanged.push(objectId);
      continue;
    }

    writes.set(objectId, patch);
    restyled.push({
      objectId,
      set,
      ...(style.refusals.length && { refused: style.refusals }),
    });
  }

  if (writes.size === 0) {
    return { elements: null, restyled, unchanged, notFound, refused };
  }

  return {
    elements: elements.map((element) =>
      writes.has(element.id) ? { ...element, ...writes.get(element.id)! } : element,
    ),
    restyled,
    unchanged,
    notFound,
    refused,
  };
}

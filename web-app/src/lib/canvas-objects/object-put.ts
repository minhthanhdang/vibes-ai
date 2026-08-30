import { placeLinesOnBoard, lineKey, textOf } from "@/lib/boards/board-line";
import { placeOnBoard } from "@/lib/boards/board-place";
import { boardFrames, type Rect } from "@/lib/canvas/moodboard-frames";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";
import { LAYOUT_TEXT_MAX_FONT, LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { renderFontOf } from "@/lib/render/render-plan";
import { setBlock } from "@/lib/render/text-set";
import { collapsed } from "@/lib/util/text";
import {
  boardPages,
  frameJoining,
  pageById,
  pageChildOrder,
  pageElements,
  type BoardPage,
} from "@/lib/pages/board-pages";
import {
  shapeDefaults,
  styleReading,
  type FontResolution,
  type StyleAsked,
  type StyleTarget,
} from "@/lib/canvas-objects/object-style";
import type { ReadableShape } from "@/lib/canvas-objects/object-read";
import { addPage } from "@/lib/pages/page-add";
import { placeLinesOnPage, placeOnPage } from "@/lib/pages/page-place";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

export type PutRequest =
  | ({ kind: "image"; referenceId: string; pageId?: string; box?: readonly number[] } & StyleAsked)
  | ({ kind: "text"; text: string; pageId?: string; box?: readonly number[] } & StyleAsked)
  | ({ kind: "shape"; shape: string; pageId?: string; box?: readonly number[] } & StyleAsked)
  | { kind: "page"; name?: string; box?: readonly number[] };

export type PutPlacement = {
  objectId: string;
  kind: "image" | "text" | "shape" | "page";
  pageId?: string;
};

export type PutRefusal = { object: string; reason: string };

export type PutClamp = {
  objectId: string;
  asked: number;
  set: number;
};

export type PutWrap = {
  objectId: string;
  lines: number;
  asked: number;
  set: number;
};

export type PutResult = {
  elements: SceneElement[] | null;
  put: PutPlacement[];
  alreadyOn: string[];
  refused: PutRefusal[];
  clamped: PutClamp[];
  wrapped: PutWrap[];
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function readBox(
  box: readonly number[] | undefined,
  flat = false,
): [number, number, number, number] | null | undefined {
  if (box === undefined) return undefined;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(finite);
  if (ymin === null || xmin === null || ymax === null || xmax === null) return null;
  if (flat) {
    if (!(ymax >= ymin && xmax >= xmin && (ymax > ymin || xmax > xmin))) return null;
  } else if (!(ymax > ymin && xmax > xmin)) return null;
  return [ymin, xmin, ymax, xmax];
}

const PUT_SHAPES: Record<string, ReadableShape> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
};

function boxRect(box: [number, number, number, number], page: BoardPage | null): Rect {
  const [ymin, xmin, ymax, xmax] = box;
  if (!page) return { x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin };
  return {
    x: page.x + (xmin / 1000) * page.width,
    y: page.y + (ymin / 1000) * page.height,
    width: ((xmax - xmin) / 1000) * page.width,
    height: ((ymax - ymin) / 1000) * page.height,
  };
}

function containedIn(
  rect: Rect,
  size: { width?: number | null; height?: number | null } | null | undefined,
): Rect {
  const width = finite(size?.width);
  const height = finite(size?.height);
  if (!width || !height || width <= 0 || height <= 0) return rect;

  const scale = Math.min(rect.width / width, rect.height / height);
  const drawn = { width: round(width * scale), height: round(height * scale) };
  return {
    x: round(rect.x + (rect.width - drawn.width) / 2),
    y: round(rect.y + (rect.height - drawn.height) / 2),
    ...drawn,
  };
}

function live(elements: readonly SceneElement[]): SceneElement[] {
  return elements.filter((element) => element.isDeleted !== true);
}

function scopeOf(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage | null,
): SceneElement[] {
  if (!page) return live(elements);
  const held = new Set(pageElements(elements, pages, page).map((element) => element.id));
  return live(elements).filter((element) => held.has(element.id));
}

function styled(
  elements: readonly SceneElement[],
  objectId: string,
  writes: Record<string, unknown>,
): SceneElement[] {
  if (!Object.keys(writes).length) return [...elements];
  return elements.map((element) => (element.id === objectId ? { ...element, ...writes } : element));
}

export function putObjects(
  elements: readonly SceneElement[],
  requests: readonly PutRequest[],
  {
    defaultSize,
    sizeOf,
    makeId = () => crypto.randomUUID(),
    fonts,
  }: {
    defaultSize: { width: number; height: number };
    sizeOf: (referenceId: string) => { width?: number | null; height?: number | null } | null | undefined;
    makeId?: () => string;
    fonts?: ReadonlyMap<string, FontResolution>;
  },
): PutResult {
  const put: PutPlacement[] = [];
  const alreadyOn: string[] = [];
  const refused: PutRefusal[] = [];
  const clamped: PutClamp[] = [];
  const wrapped: PutWrap[] = [];

  let current: SceneElement[] = [...elements];
  let changed = false;

  for (const request of requests) {
    const kind = request?.kind;
    const label =
      kind === "image"
        ? String((request as { referenceId?: unknown }).referenceId ?? "an image")
        : kind === "text"
          ? collapsed(String((request as { text?: unknown }).text ?? "")) || "a line"
          : kind === "shape"
            ? String((request as { shape?: unknown }).shape ?? "").trim() || "a shape"
            : kind === "page"
              ? String((request as { name?: unknown }).name ?? "").trim() || "a page"
              : String(kind);
    const refuse = (reason: string) => refused.push({ object: label, reason });

    if (kind !== "image" && kind !== "text" && kind !== "shape" && kind !== "page") {
      refuse("kind must be image, text, shape or page");
      continue;
    }

    const shape = kind === "shape" ? PUT_SHAPES[String((request as { shape?: unknown }).shape)] : undefined;
    if (kind === "shape" && !shape) {
      refuse(`a shape put names its shape: ${Object.keys(PUT_SHAPES).join(", ")}`);
      continue;
    }

    const box = readBox(request.box as readonly number[] | undefined, kind === "shape");
    if (box === null) {
      refuse("the box is unreadable — [ymin, xmin, ymax, xmax], and it must have room in it");
      continue;
    }

    const target: StyleTarget = kind === "page" ? "page" : kind;
    const style = styleReading(target, request as StyleAsked, shape, { resolved: fonts });
    if (style.refusals.length) {
      refuse(style.refusals.join("; "));
      continue;
    }

    const pages = boardPages(current);
    const pageIds = new Set(pages.map((page) => page.id));

    if (kind === "page") {
      if ((request as { pageId?: unknown }).pageId !== undefined) {
        refuse("a page cannot be put on a page");
        continue;
      }
      const name = typeof request.name === "string" ? request.name : null;
      const added = addPage({
        elements: current,
        defaultSize,
        name,
        ...(box && { box: boxRect(box, null) }),
        makeId,
      });
      current = added.elements;
      changed = true;
      put.push({ objectId: added.page.id, kind: "page" });
      continue;
    }

    const pageId = request.pageId;
    const page = typeof pageId === "string" && pageId ? pageById(pages, pageId) : null;
    if (pageId !== undefined && !page) {
      refuse(`no page ${String(pageId)} on this board`);
      continue;
    }

    if (kind === "shape") {
      if (box === undefined) {
        refuse(
          "a shape put names its box — a photograph and a headline have a house rule for where they go and a colour field does not",
        );
        continue;
      }

      const rect = boxRect(box, page);
      const joined = frameJoining(boardFrames(current), pages, rect);
      const element: SceneElement = {
        id: makeId(),
        type: shape!,
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        ...shapeDefaults(request as StyleAsked),
        ...style.writes,
        ...(shape === "line" && { points: [[0, 0], [round(rect.width), round(rect.height)]] }),
        ...(joined && { frameId: joined }),
      };
      current = [...current, element];
      if (joined && pageIds.has(joined)) current = pageChildOrder(current);
      changed = true;
      put.push({
        objectId: element.id,
        kind: "shape",
        ...(joined && pageIds.has(joined) && { pageId: joined }),
      });
      continue;
    }

    if (kind === "image") {
      const referenceId = typeof request.referenceId === "string" ? request.referenceId.trim() : "";
      if (!referenceId) {
        refuse("an image put names its referenceId");
        continue;
      }

      if (box === undefined) {
        const made: string[] = [];
        const capture = () => {
          const id = makeId();
          made.push(id);
          return id;
        };
        const edit = page
          ? placeOnPage({ elements: current, pages, page, add: [referenceId], sizeOf, makeId: capture })
          : placeOnBoard({
              elements: current,
              page: { x: 0, y: 0, ...defaultSize },
              add: [referenceId],
              sizeOf,
              makeId: capture,
            });
        if (edit.alreadyOn.length) {
          alreadyOn.push(referenceId);
          continue;
        }
        current = styled(edit.elements, made[0]!, style.writes);
        changed = true;
        put.push({ objectId: made[0]!, kind: "image", ...(page && { pageId: page.id }) });
        continue;
      }

      const carried = scopeOf(current, pages, page).some(
        (element) => referenceIdFromFileId(element.fileId) === referenceId,
      );
      if (carried) {
        alreadyOn.push(referenceId);
        continue;
      }

      const drawn = containedIn(boxRect(box, page), sizeOf(referenceId));
      const joined = frameJoining(boardFrames(current), pages, drawn);
      const element: SceneElement = {
        id: makeId(),
        type: "image",
        fileId: referenceFileId(referenceId),
        status: "saved",
        x: round(drawn.x),
        y: round(drawn.y),
        width: round(drawn.width),
        height: round(drawn.height),
        ...style.writes,
        ...(joined && { frameId: joined }),
      };
      current = [...current, element];
      if (joined && pageIds.has(joined)) current = pageChildOrder(current);
      changed = true;
      put.push({
        objectId: element.id,
        kind: "image",
        ...(joined && pageIds.has(joined) && { pageId: joined }),
      });
      continue;
    }

    const text = collapsed(typeof request.text === "string" ? request.text : "");
    if (!text) {
      refuse("a text put carries the words to set");
      continue;
    }

    const explicitSize = finite(style.writes.fontSize);

    if (box === undefined) {
      const made: string[] = [];
      const capture = () => {
        const id = makeId();
        made.push(id);
        return id;
      };
      const edit = page
        ? placeLinesOnPage({ elements: current, pages, page, add: [text], makeId: capture })
        : placeLinesOnBoard({
            elements: current,
            page: { x: 0, y: 0, ...defaultSize },
            add: [text],
            makeId: capture,
          });
      if (edit.alreadyOn.length) {
        alreadyOn.push(text);
        continue;
      }
      current = styled(edit.elements, made[0]!, {
        ...style.writes,
        ...(explicitSize !== null && { height: Math.round(explicitSize * TEXT_LINE_HEIGHT) }),
      });
      changed = true;
      put.push({ objectId: made[0]!, kind: "text", ...(page && { pageId: page.id }) });
      continue;
    }

    const said = scopeOf(current, pages, page).some(
      (element) => element.type === "text" && lineKey(textOf(element)) === lineKey(text),
    );
    if (said) {
      alreadyOn.push(text);
      continue;
    }

    const rect = boxRect(box, page);
    const asked = Math.round(rect.height / TEXT_LINE_HEIGHT);
    const fontSize =
      explicitSize ?? Math.min(LAYOUT_TEXT_MAX_FONT, Math.max(LAYOUT_TEXT_MIN_FONT, asked));
    const joined = frameJoining(boardFrames(current), pages, rect);
    const block = setBlock(
      text,
      rect.width,
      fontSize,
      renderFontOf({ fontFamily: style.writes.fontFamily, customData: style.writes.customData }).set,
    );
    const element: SceneElement = {
      id: makeId(),
      type: "text",
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: block.height,
      text: block.text,
      originalText: text,
      fontSize,
      textAlign: "center",
      verticalAlign: "middle",
      autoResize: false,
      ...style.writes,
      ...(joined && { frameId: joined }),
    };
    current = [...current, element];
    if (joined && pageIds.has(joined)) current = pageChildOrder(current);
    if (explicitSize === null && fontSize !== asked) {
      clamped.push({ objectId: element.id, asked, set: fontSize });
    }
    if (block.lines > 1) {
      wrapped.push({
        objectId: element.id,
        lines: block.lines,
        asked: round(rect.height),
        set: block.height,
      });
    }
    changed = true;
    put.push({
      objectId: element.id,
      kind: "text",
      ...(joined && pageIds.has(joined) && { pageId: joined }),
    });
  }

  return { elements: changed ? current : null, put, alreadyOn, refused, clamped, wrapped };
}

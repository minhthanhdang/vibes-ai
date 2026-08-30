import { normalizeHexColor } from "@/lib/analysis/analysis";
import type { Rect } from "@/lib/boards/board-contents";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type PageBackgroundMark = { pageBackground: true };

export const PAGE_BACKGROUND_NONE = "none";

export function isPageBackground(element: unknown): boolean {
  if (typeof element !== "object" || element === null) return false;
  const custom = (element as { customData?: unknown }).customData;
  if (typeof custom !== "object" || custom === null) return false;
  return (custom as { pageBackground?: unknown }).pageBackground === true;
}

export type BackedPage = Rect & { id: string };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function centreInside(element: SceneElement, page: BackedPage): boolean {
  const x = finite(element.x);
  const y = finite(element.y);
  const width = finite(element.width);
  const height = finite(element.height);
  if (x === null || y === null || width === null || height === null) return false;
  const centreX = x + width / 2;
  const centreY = y + height / 2;
  return (
    centreX >= page.x &&
    centreX <= page.x + page.width &&
    centreY >= page.y &&
    centreY <= page.y + page.height
  );
}

export function pageBackgroundOf(
  elements: readonly SceneElement[],
  page: BackedPage,
): SceneElement | null {
  for (const element of elements) {
    if (element.isDeleted === true || !isPageBackground(element)) continue;
    if (centreInside(element, page)) return element;
  }
  return null;
}

export function pageBackgroundColour(
  elements: readonly SceneElement[],
  page: BackedPage,
): string | null {
  const ground = pageBackgroundOf(elements, page);
  const colour = ground?.backgroundColor;
  return typeof colour === "string" && colour ? colour : null;
}

function groundIndex(elements: readonly SceneElement[], page: BackedPage): number {
  let frameAt = elements.length;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.id === page.id) {
      frameAt = index;
      continue;
    }
    if (element.frameId === page.id && element.type !== "frame" && element.type !== "magicframe") {
      return Math.min(index, frameAt);
    }
  }
  return frameAt;
}

function groundElement(page: BackedPage, colour: string, id: string): SceneElement {
  return {
    id,
    type: "rectangle",
    x: page.x,
    y: page.y,
    width: page.width,
    height: page.height,
    backgroundColor: colour,
    strokeColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    opacity: 100,
    angle: 0,
    locked: true,
    frameId: page.id,
    customData: { pageBackground: true } satisfies PageBackgroundMark,
  } as SceneElement;
}

export type PageBackgroundEdit = {
  elements: SceneElement[] | null;
  colour: string | null;
  was: string | null;
};

export function setPageBackground({
  elements,
  page,
  colour,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  page: BackedPage;
  colour: unknown;
  makeId?: () => string;
}): PageBackgroundEdit | null {
  const asked = typeof colour === "string" ? colour.trim() : "";
  const clearing = asked.toLowerCase() === PAGE_BACKGROUND_NONE;
  const hex = clearing ? null : normalizeHexColor(asked);
  if (!clearing && !hex) return null;

  const standing = pageBackgroundOf(elements, page);
  const was = pageBackgroundColour(elements, page);

  if (clearing) {
    if (!standing) return { elements: null, colour: null, was: null };
    return {
      elements: elements.filter((element) => element.id !== standing.id),
      colour: null,
      was,
    };
  }

  if (standing) {
    if (was && was.toLowerCase() === hex!.toLowerCase())
      return { elements: null, colour: was, was };
    return {
      elements: elements.map((element) =>
        element.id === standing.id ? { ...element, backgroundColor: hex! } : element,
      ),
      colour: hex!,
      was,
    };
  }

  const ground = groundElement(page, hex!, makeId());
  const at = groundIndex(elements, page);
  return {
    elements: [...elements.slice(0, at), ground, ...elements.slice(at)],
    colour: hex!,
    was: null,
  };
}

export function resizedPageBackground(
  elements: readonly SceneElement[],
  was: BackedPage,
  now: BackedPage,
): SceneElement[] {
  const ground = pageBackgroundOf(elements, was);
  if (!ground) return [...elements];
  return elements.map((element) =>
    element.id === ground.id
      ? { ...element, x: now.x, y: now.y, width: now.width, height: now.height }
      : element,
  );
}

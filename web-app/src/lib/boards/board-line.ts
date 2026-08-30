import { arrangementBounds } from "@/lib/boards/board-place";
import { boardItems, type Rect } from "@/lib/boards/board-contents";
import { DROPPED_IMAGE_GAP } from "@/lib/canvas/moodboard-drop";
import { LAYOUT_TEXT_MAX_FONT, LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import { collapsed, lineKey } from "@/lib/util/text";

export const LINE_NOT_ON_BOARD_NOTE =
  "that wording is not on the board — read it with inspect_board and quote the line as the board carries it";

export type LineResult = {
  elements: SceneElement[];
  added: string[];
  removed: string[];
  notOnBoard: string[];
  alreadyOn: string[];
};

export { lineKey };

export function textOf(element: SceneElement) {
  const drawn = typeof element.text === "string" ? element.text : "";
  return drawn || (typeof element.originalText === "string" ? element.originalText : "");
}

function isText(element: SceneElement) {
  return element.type === "text";
}

const HEADLINE_SHARE = 0.05;

export function placeLinesOnBoard({
  elements,
  page,
  add = [],
  remove = [],
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  page: Rect;
  add?: readonly string[];
  remove?: readonly string[];
  makeId?: () => string;
}): LineResult {
  const asked = clean(remove);
  const dropped = new Set(asked.map(lineKey));

  const carried = new Set(elements.filter(isText).map((element) => lineKey(textOf(element))));

  const kept = elements.filter(
    (element) => !(isText(element) && dropped.has(lineKey(textOf(element)))),
  );

  const wanted = clean(add);
  const alreadyOn = wanted.filter(
    (line) => carried.has(lineKey(line)) && !dropped.has(lineKey(line)),
  );
  const joining = wanted.filter(
    (line) => !carried.has(lineKey(line)) || dropped.has(lineKey(line)),
  );

  return {
    elements: [...kept, ...set(joining, kept, page, makeId)],
    added: joining,
    removed: asked.filter((line) => carried.has(lineKey(line))),
    notOnBoard: asked.filter((line) => !carried.has(lineKey(line))),
    alreadyOn,
  };
}

function clean(lines: readonly string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const text = collapsed(line);
    if (!text || seen.has(lineKey(text))) continue;
    seen.add(lineKey(text));
    out.push(text);
  }
  return out;
}

function set(
  joining: readonly string[],
  kept: readonly SceneElement[],
  page: Rect,
  makeId: () => string,
): SceneElement[] {
  if (!joining.length) return [];

  const room = arrangementBounds(boardItems(kept), page);
  const fontSize = houseFontSize(kept, room);
  const height = Math.round(fontSize * TEXT_LINE_HEIGHT);
  const stack = height * joining.length + DROPPED_IMAGE_GAP * (joining.length - 1);

  let top = room.y - DROPPED_IMAGE_GAP - stack;
  return joining.map((text) => {
    const y = top;
    top += height + DROPPED_IMAGE_GAP;
    return {
      id: makeId(),
      type: "text",
      x: round(room.x),
      y: round(y),
      width: round(room.width),
      height,
      text,
      originalText: text,
      fontSize,
      textAlign: "center",
      verticalAlign: "middle",
      autoResize: false,
    } satisfies SceneElement;
  });
}

function houseFontSize(elements: readonly SceneElement[], room: { width: number }) {
  const sizes = elements
    .filter(isText)
    .map((element) => element.fontSize)
    .filter((size): size is number => typeof size === "number" && Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b);

  const size = sizes.length
    ? sizes[Math.floor((sizes.length - 1) / 2)]!
    : Math.round(room.width * HEADLINE_SHARE);
  return Math.min(LAYOUT_TEXT_MAX_FONT, Math.max(LAYOUT_TEXT_MIN_FONT, Math.round(size)));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

import { collapsed, lineKey } from "@/lib/util/text";

import {
  LAYOUT_MAX_TEXT_BLOCKS,
  LAYOUTS_WITH_TEXT,
  composeLayoutElements,
  textSlots,
  type LayoutBlock,
  type MoodboardLayout,
  type Placement,
} from "@/lib/layout/moodboard-layouts";
import { nextPageName, pageFrame } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export const COMPOSE_BLOCK_LIMIT = 12;

export const TEXT_LINE_HEIGHT = 1.25;

function elementId(makeId: () => string) {
  const id = makeId();
  return typeof id === "string" && id.length > 0 ? id : crypto.randomUUID();
}

export type ComposedPage = {
  width: number;
  height: number;
  name?: string;
  id?: string;
};

export function composedScene(
  placements: readonly Placement[],
  {
    makeId = () => crypto.randomUUID(),
    origin,
    page,
  }: {
    makeId?: () => string;
    origin?: { x: number; y: number };
    page?: ComposedPage;
  } = {},
): SceneElement[] {
  const skeletons = composeLayoutElements(placements, origin);
  const elements = skeletons.map((skeleton) => {
    if (skeleton.type === "text") {
      const { fontSize } = skeleton;
      return {
        id: elementId(makeId),
        ...skeleton,
        height: Math.round(fontSize * TEXT_LINE_HEIGHT),
        originalText: skeleton.text,
        textAlign: "center" as const,
        verticalAlign: "middle" as const,
        autoResize: false,
      };
    }
    return { id: elementId(makeId), ...skeleton };
  });

  const drawn = [
    ...elements.filter((element) => element.type === "image"),
    ...elements.filter((element) => element.type !== "image"),
  ];
  if (!page) return drawn;

  const at = origin ?? { x: 0, y: 0 };
  const frame = pageFrame(
    { x: at.x, y: at.y, width: page.width, height: page.height },
    {
      name: page.name?.trim() || nextPageName([]),
      makeId: () => page.id ?? makeId(),
    },
  );

  return [...drawn.map((element) => ({ ...element, frameId: frame.id })), frame];
}

export function layoutBlocks(
  references: readonly { id: string; width?: number | null; height?: number | null }[],
  captions: readonly string[] = [],
  limit = COMPOSE_BLOCK_LIMIT,
): LayoutBlock[] {
  const images = references.map((reference) => ({
    id: reference.id,
    kind: "image" as const,
    width: reference.width ?? null,
    height: reference.height ?? null,
  }));

  const lines = captions
    .map(collapsed)
    .filter((caption) => caption.length > 0)
    .map((text, index) => ({ id: `caption-${index + 1}`, kind: "text" as const, text }))
    .slice(0, LAYOUT_MAX_TEXT_BLOCKS);

  return [...lines, ...images].slice(0, Math.max(0, limit));
}

export function linesNotOffered(lines: readonly string[], blocks: readonly LayoutBlock[]) {
  const offered = new Set(
    blocks.flatMap((block) => (block.kind === "text" && block.text ? [lineKey(block.text)] : [])),
  );
  return lines.filter((line) => !offered.has(lineKey(line)));
}

export const LINES_NOT_OFFERED_NOTE = `a board holds at most ${LAYOUT_MAX_TEXT_BLOCKS} lines of text, so these were not put on it — tell the user which words did not go on rather than saying the board carries them`;

export function linesWithNoSlot(blocks: readonly LayoutBlock[], layout: MoodboardLayout) {
  const room = textSlots(layout).length;
  return blocks
    .filter((block) => block.kind === "text" && block.text)
    .slice(room)
    .map((block) => block.text as string);
}

export function linesWithNoSlotNote(layout: MoodboardLayout) {
  return `${layout.id} has no text block, so these words are not on the board — say that plainly rather than that the board carries them or that the title stands in for them. ${LAYOUTS_WITH_TEXT.join(", ")} carry a line: offer to lay it out at one of those, or leave the template out and let it be chosen.`;
}

export function boardSelection({
  onBoard = [],
  requested = [],
  add = [],
  remove = [],
}: {
  onBoard?: readonly string[];
  requested?: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
}) {
  const base = [...new Set(requested.length ? requested : onBoard)];
  const dropped = new Set(remove);

  const added = [...new Set(add)].filter((id) => !base.includes(id));
  const selection = [...base, ...added].filter((id) => !dropped.has(id));

  return {
    selection,
    added: added.filter((id) => !dropped.has(id)),
    removed: [...new Set(remove)].filter((id) => base.includes(id) || added.includes(id)),
    notOnBoard: [...new Set(remove)].filter((id) => !base.includes(id) && !added.includes(id)),
    alreadyOn: [...new Set(add)].filter((id) => base.includes(id)),
  };
}

export function lineSelection({
  onBoard = [],
  requested = [],
  add = [],
  remove = [],
}: {
  onBoard?: readonly string[];
  requested?: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
}) {
  const clean = (lines: readonly string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const text = collapsed(line);
      if (!text || seen.has(lineKey(text))) continue;
      seen.add(lineKey(text));
      out.push(text);
    }
    return out;
  };

  const base = clean(requested.length ? requested : onBoard);
  const asked = clean(add);
  const dropped = clean(remove);
  const held = new Set(base.map(lineKey));

  const added = asked.filter((line) => !held.has(lineKey(line)));
  const goes = new Set(dropped.map(lineKey));
  const lines = [...base, ...added].filter((line) => !goes.has(lineKey(line)));

  const kept = new Set([...base, ...added].map(lineKey));
  return {
    lines,
    added: added.filter((line) => !goes.has(lineKey(line))),
    removed: dropped.filter((line) => kept.has(lineKey(line))),
    notOnBoard: dropped.filter((line) => !kept.has(lineKey(line))),
    alreadyOn: asked.filter((line) => held.has(lineKey(line))),
  };
}

function given(value: unknown) {
  return typeof value === "string" && !!value.trim();
}

export function renamesOnly({
  title = "",
  pageName = "",
  newPage,
  referenceIds = [],
  addReferenceIds = [],
  removeReferenceIds = [],
  captions = [],
  addCaptions = [],
  removeCaptions = [],
  layout,
  layoutImageId,
}: {
  title?: string;
  pageName?: string;
  newPage?: unknown;
  referenceIds?: readonly string[];
  addReferenceIds?: readonly string[];
  removeReferenceIds?: readonly string[];
  captions?: readonly string[];
  addCaptions?: readonly string[];
  removeCaptions?: readonly string[];
  layout?: unknown;
  layoutImageId?: unknown;
}) {
  if (newPage === true) return false;
  if (!title.trim() && !pageName.trim()) return false;
  if (given(layout) || given(layoutImageId)) return false;
  return [
    referenceIds,
    addReferenceIds,
    removeReferenceIds,
    captions,
    addCaptions,
    removeCaptions,
  ].every((asked) => asked.every((entry) => !entry.trim()));
}

export function changesContentsOnly({
  referenceIds = [],
  addReferenceIds = [],
  removeReferenceIds = [],
  captions = [],
  addCaptions = [],
  removeCaptions = [],
  layout,
  layoutImageId,
}: {
  referenceIds?: readonly string[];
  addReferenceIds?: readonly string[];
  removeReferenceIds?: readonly string[];
  captions?: readonly string[];
  addCaptions?: readonly string[];
  removeCaptions?: readonly string[];
  layout?: unknown;
  layoutImageId?: unknown;
}) {
  if (given(layout) || given(layoutImageId)) return false;
  const changed = [...addReferenceIds, ...removeReferenceIds, ...addCaptions, ...removeCaptions];
  if (!changed.some((entry) => entry.trim())) return false;
  return [referenceIds, captions].every((asked) => asked.every((entry) => !entry.trim()));
}

export const COMPOSED_TITLE_LIMIT = 60;

export function composedBoardTitle(intention: string, fallback = "Composed board") {
  const title = collapsed(intention);
  if (!title) return fallback;
  return title.length > COMPOSED_TITLE_LIMIT
    ? `${title.slice(0, COMPOSED_TITLE_LIMIT - 1).trimEnd()}…`
    : title;
}

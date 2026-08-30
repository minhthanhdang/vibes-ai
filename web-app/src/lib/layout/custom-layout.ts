import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";
import {
  CUSTOM_LAYOUT,
  PAGE_PRESETS,
  layoutById,
  type LayoutSlot,
  type MoodboardLayout,
  type PagePresetId,
  type SlotKind,
} from "@/lib/layout/moodboard-layouts";
import { pageReadingOrder } from "@/lib/pages/board-pages";
import { CROP_BOX_SCALE, cropBoxOf, type CropBox } from "@/lib/references/reference-version";

export type LayoutBox = { box: unknown; kind: unknown };

export type CustomLayoutAttempt = { layout: MoodboardLayout } | { fault: string };

const MIN_SIDE_UNITS = Math.round(0.02 * CROP_BOX_SCALE);

export function customComposition(slots: readonly LayoutSlot[]) {
  const images = slots.filter((slot) => slot.kind === "image").length;
  const texts = slots.length - images;
  const parts = [`${images} image ${images === 1 ? "placeholder" : "placeholders"}`];
  if (texts) parts.push(`${texts} text ${texts === 1 ? "area" : "areas"}`);
  return `A layout read off a page that was handed in: ${parts.join(" and ")}, read left to right and top to bottom.`;
}

function slotKindOf(value: unknown): SlotKind | null {
  return value === "image" || value === "text" ? value : null;
}

export function pagePresetForAspect(image: { width?: unknown; height?: unknown }): PagePresetId {
  const width = finite(image.width);
  const height = finite(image.height);
  if (!width || !height) return "LANDSCAPE_HD";

  const aspect = width / height;
  let nearest: PagePresetId = "LANDSCAPE_HD";
  let best = Infinity;
  for (const id of Object.keys(PAGE_PRESETS) as PagePresetId[]) {
    const preset = PAGE_PRESETS[id];
    const distance = Math.abs(Math.log(aspect / (preset.width / preset.height)));
    if (distance < best) {
      best = distance;
      nearest = id;
    }
  }
  return nearest;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function usableBox(value: unknown, index: number): { box: CropBox } | { fault: string } {
  const box = cropBoxOf(value);
  if (!box) {
    return {
      fault: `box ${index + 1} was not a box of the layout image. Answer with [ymin, xmin, ymax, xmax] — four whole numbers between 0 and ${CROP_BOX_SCALE}, ymin below ymax and xmin below xmax.`,
    };
  }

  const thin = (
    [
      ["height", box.ymax - box.ymin],
      ["width", box.xmax - box.xmin],
    ] as const
  ).find(([, side]) => side < MIN_SIDE_UNITS);
  if (thin) {
    const [edge, side] = thin;
    return {
      fault: `box ${index + 1} is ${side}/${CROP_BOX_SCALE} of the page's ${edge}, which is a ruled line rather than a placeholder. Answer with the whole of the area the block goes in, and leave out borders and rules.`,
    };
  }

  return { box };
}

export function layoutFromBoxes({
  boxes,
  image,
  composition,
}: {
  boxes: unknown;
  image: { width?: unknown; height?: unknown };
  composition?: unknown;
}): CustomLayoutAttempt {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return {
      fault:
        "no placeholders were found on that page. Answer with one box per area a photograph or a line of text goes in.",
    };
  }
  if (boxes.length > COMPOSE_BLOCK_LIMIT) {
    return {
      fault: `that page has ${boxes.length} placeholders on it and a board holds ${COMPOSE_BLOCK_LIMIT}. Answer with the areas that hold a photograph or a line of text, and leave out borders, rules and decoration.`,
    };
  }

  const read: { box: CropBox; kind: SlotKind }[] = [];
  for (const [index, entry] of boxes.entries()) {
    const kind = slotKindOf((entry as LayoutBox | null)?.kind);
    if (!kind) {
      return {
        fault: `box ${index + 1} is tagged "${String((entry as LayoutBox | null)?.kind)}". Tag each box "image" for a placeholder a photograph goes in or "text" for a ruled area words go in.`,
      };
    }
    const attempt = usableBox((entry as LayoutBox).box, index);
    if ("fault" in attempt) return attempt;
    read.push({ box: attempt.box, kind });
  }

  if (!read.some((entry) => entry.kind === "image")) {
    return {
      fault:
        "that page has no image placeholder on it, only text areas. A moodboard page is photographs first — answer with the boxes the photographs go in.",
    };
  }

  const page = PAGE_PRESETS[pagePresetForAspect(image)];
  const placed = read.map(({ box, kind }) => ({
    kind,
    x: rounded((box.xmin / CROP_BOX_SCALE) * page.width),
    y: rounded((box.ymin / CROP_BOX_SCALE) * page.height),
    width: rounded(((box.xmax - box.xmin) / CROP_BOX_SCALE) * page.width),
    height: rounded(((box.ymax - box.ymin) / CROP_BOX_SCALE) * page.height),
  }));

  const counts = { image: 0, text: 0 };
  const slots: LayoutSlot[] = pageReadingOrder(placed, { x: 0, y: 0, ...page }).map((box) => {
    counts[box.kind] += 1;
    return { id: `${box.kind === "image" ? "img" : "text"}-${counts[box.kind]}`, ...box };
  });

  const line = typeof composition === "string" ? composition.trim() : "";
  return {
    layout: {
      id: CUSTOM_LAYOUT,
      page: { ...page },
      composition: line || customComposition(slots),
      slots,
    },
  };
}

export function customLayoutColumns(layout: MoodboardLayout) {
  return {
    page: layout.page,
    composition: layout.composition,
    slots: layout.slots.map((slot) => ({
      id: slot.id,
      kind: slot.kind,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      ...(slot.angle && { angle: slot.angle }),
    })),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storedSlot(value: unknown): LayoutSlot | null {
  const raw = record(value);
  if (!raw) return null;

  const kind = slotKindOf(raw.kind);
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const width = finite(raw.width);
  const height = finite(raw.height);
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : null;
  const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : null;
  if (!kind || !id || !width || !height || x === null || y === null) return null;

  const angle = typeof raw.angle === "number" && Number.isFinite(raw.angle) ? raw.angle : null;
  return { id, kind, x, y, width, height, ...(angle && { angle }) };
}

export function storedCustomLayout(row: { layoutSlots?: unknown } | null | undefined) {
  const stored = record(row?.layoutSlots);
  if (!stored) return null;

  const page = record(stored.page);
  const width = finite(page?.width);
  const height = finite(page?.height);
  if (!width || !height) return null;

  if (!Array.isArray(stored.slots) || stored.slots.length === 0) return null;
  if (stored.slots.length > COMPOSE_BLOCK_LIMIT) return null;

  const slots: LayoutSlot[] = [];
  for (const value of stored.slots) {
    const slot = storedSlot(value);
    if (!slot) return null;
    slots.push(slot);
  }
  if (!slots.some((slot) => slot.kind === "image")) return null;

  const composition = typeof stored.composition === "string" ? stored.composition.trim() : "";
  const layout: MoodboardLayout = {
    id: CUSTOM_LAYOUT,
    page: { width, height },
    composition: composition || customComposition(slots),
    slots,
  };
  return layout;
}

export function boardLayout(
  board: { layout?: unknown; layoutSlots?: unknown } | null | undefined,
): MoodboardLayout | null {
  if (!board) return null;
  return board.layout === CUSTOM_LAYOUT ? storedCustomLayout(board) : layoutById(board.layout);
}

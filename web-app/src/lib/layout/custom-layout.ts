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

/// The layout reader's half of a custom page (tech-spec §III.4), minus the model.
///
/// A layout image is a picture of the page the user wants: placeholder boxes
/// where photographs go, ruled areas where text goes. The model answers with one
/// `[ymin, xmin, ymax, xmax]` per mark and nothing else — the same division of
/// labour as agent 3, and the same one the ten templates already keep. Turning
/// those boxes into a page rect and a set of slots is arithmetic, so it happens
/// here, where it can be exercised without a vision call.
///
/// Everything downstream then reads a `CUSTOM` layout exactly as it reads
/// `HERO_LEFT`: shapes and shares in the brief, coordinates never.
///
/// No server imports, no model call: what goes in is boxes, what comes out is a
/// layout or the sentence saying why there isn't one.

/// One mark on the page as the model reports it: Gemini's own box, tagged with
/// what the mark is for.
export type LayoutBox = { box: unknown; kind: unknown };

/// The layout, or the sentence saying why there isn't one. Same union and same
/// contract as `usableCropBox`: the fault is written for the model, because it is
/// what the reader's re-prompt appends.
export type CustomLayoutAttempt = { layout: MoodboardLayout } | { fault: string };

/// The smallest edge a placeholder may have and still be a place a photograph
/// goes, in the model's own units. The crop's misfire threshold, reused: 2% of a
/// page is a rule drawn on it rather than an opening cut into it, and a slot that
/// thin cannot hold a picture at any page size.
const MIN_SIDE_UNITS = Math.round(0.02 * CROP_BOX_SCALE);

/// What a `CUSTOM` layout's composition line says when the reader gave none. The
/// compositor decides hero from filler out of this plus the slot sizes, so it is
/// never left empty — a brief with a blank line where the other ten have a
/// sentence reads as a page nobody could describe.
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

/// The page rect a layout image is drawn onto: the preset whose shape is closest
/// to the picture's own (§V.1).
///
/// Nearest by *ratio* rather than by difference, because aspect is a ratio: a
/// 1.2 page is as far from square as a 0.83 page is, and subtracting would call
/// one of them much closer. A picture with no readable size lands on the wide
/// preset, which is the shape most pages handed in are.
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

/// A box read off the layout image, checked the way the cropper's is: is it a
/// rectangle at all, and is the rectangle a shape something goes in.
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

/// The boxes the reader answered with, as a layout.
///
/// The page is the preset nearest the layout image's own shape and the boxes are
/// scaled straight onto it — a share of each edge, not letterboxed. The picture
/// *is* the page: fitting it inside the preset would leave a margin the page
/// handed in did not have, and every slot would sit in from an edge the user
/// drew a placeholder against.
///
/// Slot ids are `img-1…`/`text-1…` in the order a person reads the page (§V.4):
/// banded by y, then left to right. The compositor is told nothing about where a
/// slot is beyond its shape and share, so reading order is the whole of what
/// `img-1` means to it — and a page numbered in the order the model happened to
/// emit boxes would make "the opening image" a different place every read.
export function layoutFromBoxes({
  boxes,
  image,
  composition,
}: {
  boxes: unknown;
  image: { width?: unknown; height?: unknown };
  /// The reader's own line about what the page is, written the way the
  /// templates' are. Optional here so the geometry can be checked on its own.
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

/// The layout as the board row stores it — the whole of what `CUSTOM` means,
/// because there is no constants file to look it up in.
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

/// The board's own layout, read back off the row.
///
/// Null for anything that is not a whole layout — a column written by an older
/// build, a half-written Json, a page with no image slot left in it. A rebuild
/// that read a broken custom layout would compose onto slots that are not there;
/// null sends it back through `layoutForBoard`, which picks a template, and the
/// user gets a board rather than an exception.
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

/// The layout a board was composed at, whichever kind it is. Every call site that
/// used to reach for `layoutById(board.layout)` reaches for this instead: a board
/// laid out from a layout image stores `CUSTOM` in the same column, and looking
/// that up in the template table answers null — a board that would then read as
/// one nobody composed.
export function boardLayout(
  board: { layout?: unknown; layoutSlots?: unknown } | null | undefined,
): MoodboardLayout | null {
  if (!board) return null;
  return board.layout === CUSTOM_LAYOUT ? storedCustomLayout(board) : layoutById(board.layout);
}

import { referenceFileId } from "@/lib/scene/moodboard-scene";

export const LAYOUT_IDS = [
  "SPLIT",
  "TRIPTYCH",
  "FILMSTRIP",
  "GOLDEN_RATIO",
  "POLAROID_SCATTER",
  "HERO_LEFT",
  "MASONRY",
  "EDITORIAL_SPREAD",
  "MOSAIC",
  "GRID_3X3",
] as const;

export type LayoutId = (typeof LAYOUT_IDS)[number];

export const LAYOUT_REQUESTS = [...LAYOUT_IDS, "RANDOM"] as const;
export type LayoutRequest = (typeof LAYOUT_REQUESTS)[number];

export type SlotKind = "image" | "text";

export type LayoutSlot = {
  id: string;
  kind: SlotKind;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
};

export type LayoutName = LayoutId | "CUSTOM";

export const CUSTOM_LAYOUT = "CUSTOM" as const;

export type MoodboardLayout = {
  id: LayoutName;
  page: { width: number; height: number };
  composition: string;
  slots: LayoutSlot[];
};

const MARGIN = 48;
const GUTTER = 24;

export const PAGE_PRESETS = {
  LANDSCAPE_HD: { width: 1920, height: 1080 },
  PORTRAIT_HD: { width: 1080, height: 1920 },
  SQUARE: { width: 2048, height: 2048 },
} as const;

export type PagePresetId = keyof typeof PAGE_PRESETS;

export const PAGE_PRESET_IDS = Object.keys(PAGE_PRESETS) as PagePresetId[];

export const PAGE_GAP = 120;

const WIDE = PAGE_PRESETS.LANDSCAPE_HD;
const SQUARE = PAGE_PRESETS.SQUARE;
const TALL = PAGE_PRESETS.PORTRAIT_HD;

function imageSlotId(index: number) {
  return `img-${index + 1}`;
}

function textSlotId(index: number) {
  return `text-${index + 1}`;
}

function panelRow(
  page: { width: number; height: number },
  count: number,
  aspect?: number,
): LayoutSlot[] {
  const width = (page.width - 2 * MARGIN - (count - 1) * GUTTER) / count;
  const height = aspect ? width / aspect : page.height - 2 * MARGIN;
  const y = aspect ? (page.height - height) / 2 : MARGIN;

  return Array.from({ length: count }, (_, index) => ({
    id: imageSlotId(index),
    kind: "image" as const,
    x: MARGIN + index * (width + GUTTER),
    y,
    width,
    height,
  }));
}

function uniformGrid(
  page: { width: number; height: number },
  columns: number,
  rows: number,
): LayoutSlot[] {
  const width = (page.width - 2 * MARGIN - (columns - 1) * GUTTER) / columns;
  const height = (page.height - 2 * MARGIN - (rows - 1) * GUTTER) / rows;

  return Array.from({ length: columns * rows }, (_, index) => ({
    id: imageSlotId(index),
    kind: "image" as const,
    x: MARGIN + (index % columns) * (width + GUTTER),
    y: MARGIN + Math.floor(index / columns) * (height + GUTTER),
    width,
    height,
  }));
}

function goldenSpiral(): LayoutSlot[] {
  const boxes = [
    { x: 48, y: 421, width: 1206, height: 1206 },
    { x: 1254, y: 421, width: 746, height: 746 },
    { x: 1540, y: 1167, width: 460, height: 460 },
    { x: 1254, y: 1341, width: 286, height: 286 },
    { x: 1254, y: 1167, width: 286, height: 174 },
  ];

  return boxes.map((box, index) => ({
    id: imageSlotId(index),
    kind: "image" as const,
    x: box.x + GUTTER / 2,
    y: box.y + GUTTER / 2,
    width: box.width - GUTTER,
    height: box.height - GUTTER,
  }));
}

function polaroidScatter(): LayoutSlot[] {
  const tiles = [
    { x: 180, y: 200, size: 680, angle: -0.08 },
    { x: 760, y: 140, size: 620, angle: 0.06 },
    { x: 1240, y: 320, size: 640, angle: -0.05 },
    { x: 300, y: 880, size: 700, angle: 0.07 },
    { x: 1020, y: 1020, size: 660, angle: -0.04 },
  ];

  return [
    ...tiles.map((tile, index) => ({
      id: imageSlotId(index),
      kind: "image" as const,
      x: tile.x,
      y: tile.y,
      width: tile.size,
      height: tile.size,
      angle: tile.angle,
    })),
    { id: textSlotId(0), kind: "text", x: 520, y: 1780, width: 1000, height: 140, angle: 0.02 },
  ];
}

function heroLeft(): LayoutSlot[] {
  const hero = { x: MARGIN, y: MARGIN, width: 1104, height: 984 };
  const column = { x: 1176, width: 696 };
  const support = 198;
  const caption = 96;

  return [
    { id: imageSlotId(0), kind: "image", ...hero },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: imageSlotId(index + 1),
      kind: "image" as const,
      x: column.x,
      y: MARGIN + index * (support + GUTTER),
      width: column.width,
      height: support,
    })),
    {
      id: textSlotId(0),
      kind: "text",
      x: column.x,
      y: MARGIN + 4 * (support + GUTTER),
      width: column.width,
      height: caption,
    },
  ];
}

function masonry(): LayoutSlot[] {
  const columnWidth = (TALL.width - 2 * MARGIN - GUTTER) / 2;
  const columns = [
    { x: MARGIN, heights: [420, 560, 380, 392] },
    { x: MARGIN + columnWidth + GUTTER, heights: [640, 560, 576] },
  ];

  const slots: LayoutSlot[] = [];
  for (const column of columns) {
    let y = MARGIN;
    for (const height of column.heights) {
      slots.push({
        id: imageSlotId(slots.length),
        kind: "image",
        x: column.x,
        y,
        width: columnWidth,
        height,
      });
      y += height + GUTTER;
    }
  }
  return slots;
}

function editorialSpread(): LayoutSlot[] {
  const content = WIDE.width - 2 * MARGIN;
  return [
    { id: textSlotId(0), kind: "text", x: MARGIN, y: MARGIN, width: content, height: 120 },
    { id: imageSlotId(0), kind: "image", x: MARGIN, y: 192, width: 900, height: 744 },
    { id: imageSlotId(1), kind: "image", x: 972, y: 192, width: 426, height: 360 },
    { id: imageSlotId(2), kind: "image", x: 1422, y: 192, width: 450, height: 360 },
    { id: imageSlotId(3), kind: "image", x: 972, y: 576, width: 426, height: 360 },
    { id: imageSlotId(4), kind: "image", x: 1422, y: 576, width: 450, height: 360 },
    { id: textSlotId(1), kind: "text", x: MARGIN, y: 960, width: content, height: 72 },
  ];
}

function mosaic(): LayoutSlot[] {
  const tiles = [
    { x: 0, y: 0, width: 1024, height: 1024 },
    { x: 1024, y: 0, width: 512, height: 512 },
    { x: 1536, y: 0, width: 512, height: 512 },
    { x: 1024, y: 512, width: 1024, height: 512 },
    { x: 0, y: 1024, width: 512, height: 1024 },
    { x: 512, y: 1024, width: 512, height: 1024 },
    { x: 1024, y: 1024, width: 512, height: 1024 },
    { x: 1536, y: 1024, width: 512, height: 1024 },
  ];

  return tiles.map((tile, index) => ({
    id: imageSlotId(index),
    kind: "image" as const,
    ...tile,
  }));
}

export const MOODBOARD_LAYOUTS: readonly MoodboardLayout[] = [
  {
    id: "SPLIT",
    page: WIDE,
    composition: "Half-and-half diptych: two images of equal weight, read left then right.",
    slots: panelRow(WIDE, 2),
  },
  {
    id: "TRIPTYCH",
    page: WIDE,
    composition: "Three vertical panels of equal weight, read left to right.",
    slots: panelRow(WIDE, 3),
  },
  {
    id: "FILMSTRIP",
    page: WIDE,
    composition: "One row of four cinema frames across the middle of the page, in sequence.",
    slots: panelRow(WIDE, 4, 16 / 9),
  },
  {
    id: "GOLDEN_RATIO",
    page: SQUARE,
    composition:
      "Fibonacci spiral: each block is smaller than the last, so img-1 is the anchor and img-5 is an accent.",
    slots: goldenSpiral(),
  },
  {
    id: "POLAROID_SCATTER",
    page: SQUARE,
    composition:
      "Tilted, overlapping instant photos with a hand-written line under them. Loose and equal-weight.",
    slots: polaroidScatter(),
  },
  {
    id: "HERO_LEFT",
    page: WIDE,
    composition:
      "One large hero image on the left with a supporting column of four and a caption on the right.",
    slots: heroLeft(),
  },
  {
    id: "MASONRY",
    page: TALL,
    composition:
      "Portrait page, two staggered columns of seven images, no two rows aligned. Read down the left column first.",
    slots: masonry(),
  },
  {
    id: "EDITORIAL_SPREAD",
    page: WIDE,
    composition:
      "Magazine spread: headline across the top, a full plate on the left, four supporting images to its right, a caption line under everything.",
    slots: editorialSpread(),
  },
  {
    id: "MOSAIC",
    page: SQUARE,
    composition:
      "Full-bleed tiles with no gutters: one large square top-left, then mixed sizes filling the page edge to edge.",
    slots: mosaic(),
  },
  {
    id: "GRID_3X3",
    page: SQUARE,
    composition: "Classic uniform three-by-three grid, read left to right and top to bottom.",
    slots: uniformGrid(SQUARE, 3, 3),
  },
];

const BY_ID = new Map(MOODBOARD_LAYOUTS.map((layout) => [layout.id, layout]));

export function layoutById(id: unknown): MoodboardLayout | null {
  return typeof id === "string" ? (BY_ID.get(id as LayoutId) ?? null) : null;
}

export function layoutLabel(id: LayoutName) {
  const [first, ...rest] = id.toLowerCase().split("_");
  if (!first) return id;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

export function imageSlots(layout: MoodboardLayout) {
  return layout.slots.filter((slot) => slot.kind === "image");
}

export function textSlots(layout: MoodboardLayout) {
  return layout.slots.filter((slot) => slot.kind === "text");
}

export const LAYOUT_MIN_BLOCKS = Math.min(...MOODBOARD_LAYOUTS.map((l) => l.slots.length));
export const LAYOUT_MAX_BLOCKS = Math.max(...MOODBOARD_LAYOUTS.map((l) => l.slots.length));

export const LAYOUT_MAX_TEXT_BLOCKS = Math.max(...MOODBOARD_LAYOUTS.map((l) => textSlots(l).length));

export const LAYOUTS_WITH_TEXT = MOODBOARD_LAYOUTS.filter((l) => textSlots(l).length > 0).map(
  (l) => l.id,
);

function seats(layout: MoodboardLayout, blocks: readonly { kind: SlotKind }[]) {
  const wanted = { image: 0, text: 0 };
  for (const block of blocks) wanted[block.kind] += 1;
  return (
    Math.min(imageSlots(layout).length, wanted.image) +
    Math.min(textSlots(layout).length, wanted.text)
  );
}

export function resolveLayout({
  blocks,
  requested,
  pick = Math.random,
}: {
  blocks: readonly { kind: SlotKind }[];
  requested?: unknown;
  pick?: () => number;
}): MoodboardLayout {
  const named = layoutById(requested);
  if (named) return named;

  const seated = MOODBOARD_LAYOUTS.map((layout) => ({ layout, count: seats(layout, blocks) }));
  const most = Math.max(...seated.map((entry) => entry.count));
  const best = seated.filter((entry) => entry.count === most);
  const tightest = Math.min(...best.map((entry) => entry.layout.slots.length));
  const candidates = best
    .filter((entry) => entry.layout.slots.length === tightest)
    .map((entry) => entry.layout);
  if (candidates.length === 0) return MOODBOARD_LAYOUTS[0]!;

  const index = Math.min(candidates.length - 1, Math.floor(pick() * candidates.length));
  return candidates[Math.max(0, index)]!;
}

export type LayoutChoiceReason = "requested" | "kept" | "outgrew" | "chosen";

export type LayoutChoice = { layout: MoodboardLayout; reason: LayoutChoiceReason };

function holds(layout: MoodboardLayout, blocks: readonly { kind: SlotKind }[]) {
  return seats(layout, blocks) === blocks.length;
}

export function layoutForBoard({
  stored,
  requested,
  blocks,
  pick,
}: {
  stored?: unknown;
  requested?: unknown;
  blocks: readonly { kind: SlotKind }[];
  pick?: () => number;
}): LayoutChoice {
  const named = layoutById(requested);
  if (named) return { layout: named, reason: "requested" };

  const already = resolvedLayout(stored);
  const held = requested === "RANDOM" ? null : already;
  if (held && holds(held, blocks)) return { layout: held, reason: "kept" };

  const layout = resolveLayout({ blocks, requested, pick });
  return { layout, reason: already && requested !== "RANDOM" ? "outgrew" : "chosen" };
}

function resolvedLayout(stored: unknown): MoodboardLayout | null {
  if (typeof stored === "object" && stored !== null && Array.isArray((stored as MoodboardLayout).slots)) {
    return stored as MoodboardLayout;
  }
  return layoutById(stored);
}

export function layoutOnPage(
  layout: MoodboardLayout,
  page: { width: number; height: number },
): MoodboardLayout {
  if (page.width === layout.page.width && page.height === layout.page.height) return layout;

  const scale = Math.min(page.width / layout.page.width, page.height / layout.page.height);
  if (!Number.isFinite(scale) || scale <= 0) return layout;

  const left = (page.width - layout.page.width * scale) / 2;
  const top = (page.height - layout.page.height * scale) / 2;

  return {
    ...layout,
    page: { width: page.width, height: page.height },
    slots: layout.slots.map((slot) => ({
      ...slot,
      x: left + slot.x * scale,
      y: top + slot.y * scale,
      width: slot.width * scale,
      height: slot.height * scale,
    })),
  };
}

export type SlotBrief = {
  id: string;
  kind: SlotKind;
  shape: string;
  share: number;
};

export function slotBrief(slot: LayoutSlot, page: { width: number; height: number }): SlotBrief {
  return {
    id: slot.id,
    kind: slot.kind,
    shape: `${(slot.width / slot.height).toFixed(2)}:1`,
    share: Math.round((100 * slot.width * slot.height) / (page.width * page.height)),
  };
}

export function layoutBrief(layout: MoodboardLayout) {
  return {
    layout: layout.id,
    page: `${layout.page.width}x${layout.page.height}`,
    composition: layout.composition,
    slots: layout.slots.map((slot) => slotBrief(slot, layout.page)),
  };
}

export type LayoutBlock = {
  id: string;
  kind: SlotKind;
  width?: number | null;
  height?: number | null;
  text?: string | null;
};

export type SlotAssignment = { blockId: string; slotId: string };

export type Placement = { slot: LayoutSlot; block: LayoutBlock };

export type AssignmentPlan = {
  placed: Placement[];
  unknownBlocks: string[];
  unknownSlots: string[];
  unplaced: string[];
  mismatched: SlotAssignment[];
};

export function planAssignments(
  layout: MoodboardLayout,
  assignments: readonly SlotAssignment[],
  blocks: readonly LayoutBlock[],
): AssignmentPlan {
  const slotsById = new Map(layout.slots.map((slot) => [slot.id, slot]));
  const blocksById = new Map(blocks.map((block) => [block.id, block]));

  const placed: Placement[] = [];
  const unknownBlocks: string[] = [];
  const unknownSlots: string[] = [];
  const mismatched: SlotAssignment[] = [];
  const takenSlots = new Set<string>();
  const takenBlocks = new Set<string>();

  for (const assignment of assignments) {
    const slot = slotsById.get(assignment.slotId);
    const block = blocksById.get(assignment.blockId);

    if (!block) {
      if (!unknownBlocks.includes(assignment.blockId)) unknownBlocks.push(assignment.blockId);
      continue;
    }
    if (!slot) {
      if (!unknownSlots.includes(assignment.slotId)) unknownSlots.push(assignment.slotId);
      continue;
    }
    if (takenSlots.has(slot.id) || takenBlocks.has(block.id)) continue;
    if (slot.kind !== block.kind) {
      mismatched.push(assignment);
      continue;
    }

    takenSlots.add(slot.id);
    takenBlocks.add(block.id);
    placed.push({ slot, block });
  }

  return {
    placed,
    unknownBlocks,
    unknownSlots,
    unplaced: blocks.filter((block) => !takenBlocks.has(block.id)).map((block) => block.id),
    mismatched,
  };
}

export type SeatedPlan = AssignmentPlan & {
  seated: string[];
};

export function seatUnplaced(
  layout: MoodboardLayout,
  plan: AssignmentPlan,
  blocks: readonly LayoutBlock[],
): SeatedPlan {
  const taken = new Set(plan.placed.map((placement) => placement.slot.id));
  const free = layout.slots.filter((slot) => !taken.has(slot.id));
  const leftover = plan.unplaced
    .map((id) => blocks.find((block) => block.id === id))
    .filter((block): block is LayoutBlock => Boolean(block));

  if (!plan.placed.length || !free.length || !leftover.length) return { ...plan, seated: [] };

  const placed = [...plan.placed];
  const seated: string[] = [];

  for (const block of leftover) {
    const index = free.findIndex((slot) => slot.kind === block.kind);
    if (index === -1) continue;
    placed.push({ slot: free[index]!, block });
    free.splice(index, 1);
    seated.push(block.id);
  }

  return {
    ...plan,
    placed,
    seated,
    unplaced: plan.unplaced.filter((id) => !seated.includes(id)),
  };
}

function finiteSize(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

export function fitInSlot(slot: LayoutSlot, block: LayoutBlock) {
  const width = finiteSize(block.width);
  const height = finiteSize(block.height);
  if (!width || !height) {
    return { x: slot.x, y: slot.y, width: slot.width, height: slot.height };
  }

  const scale = Math.min(slot.width / width, slot.height / height);
  const drawn = { width: rounded(width * scale), height: rounded(height * scale) };
  return {
    x: rounded(slot.x + (slot.width - drawn.width) / 2),
    y: rounded(slot.y + (slot.height - drawn.height) / 2),
    ...drawn,
  };
}

const TEXT_SLOT_FILL = 0.6;
export const LAYOUT_TEXT_MIN_FONT = 12;
export const LAYOUT_TEXT_MAX_FONT = 96;

export function slotFontSize(slot: LayoutSlot) {
  const size = Math.round(slot.height * TEXT_SLOT_FILL);
  return Math.min(LAYOUT_TEXT_MAX_FONT, Math.max(LAYOUT_TEXT_MIN_FONT, size));
}

export function composeLayoutElements(
  placements: readonly Placement[],
  origin: { x: number; y: number } = { x: 0, y: 0 },
) {
  return placements.map(({ slot, block }) => {
    const angle = slot.angle;
    if (slot.kind === "text") {
      return {
        type: "text" as const,
        x: rounded(origin.x + slot.x),
        y: rounded(origin.y + slot.y),
        width: slot.width,
        text: (block.text ?? "").trim(),
        fontSize: slotFontSize(slot),
        ...(angle && { angle }),
      };
    }

    const box = fitInSlot(slot, block);
    return {
      type: "image" as const,
      fileId: referenceFileId(block.id),
      status: "saved" as const,
      ...box,
      x: rounded(origin.x + box.x),
      y: rounded(origin.y + box.y),
      ...(angle && { angle }),
    };
  });
}

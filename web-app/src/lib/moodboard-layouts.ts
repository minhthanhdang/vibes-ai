import { referenceFileId } from "./moodboard-scene";

/// Agent 4's half of the board, minus the model (tech-spec §III.4).
///
/// A layout is a fixed template: a page size plus slots, each slot an image or
/// a text block with a position and a size. The coordinates live here and never
/// in the model — the compositor is asked *which block goes in which slot*, and
/// deterministic code turns that answer into elements. Same division of labour
/// as agent 3: the model emits judgement, code emits pixels and coordinates.
///
/// No canvas, no React, no DOM: what goes in is counts and assignments, what
/// comes out is boxes and element skeletons.

/// The ten templates, by the name the orchestrator passes down. `RANDOM` is not
/// one of them — it resolves to one of these before the model is called, so the
/// compositor always receives a concrete layout.
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

/// What the orchestrator may ask for: a template by name, or "you choose".
export const LAYOUT_REQUESTS = [...LAYOUT_IDS, "RANDOM"] as const;
export type LayoutRequest = (typeof LAYOUT_REQUESTS)[number];

export type SlotKind = "image" | "text";

/// One place on the page, in page coordinates. `angle` is excalidraw's own —
/// radians, clockwise — and only the scatter uses it; a slot without one is
/// square to the page.
export type LayoutSlot = {
  id: string;
  kind: SlotKind;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
};

export type MoodboardLayout = {
  id: LayoutId;
  page: { width: number; height: number };
  /// The one line the model is given about what this template *is*. It decides
  /// hero versus filler and reading order from this plus the slot sizes, so it
  /// is written for a reader who cannot see the page.
  composition: string;
  slots: LayoutSlot[];
};

/// The breathing room every gutter-bearing layout uses. The board's own drop
/// gap, scaled up: these pages are 1920 wide where a dropped photo is 320, so
/// the proportion rather than the number is what carries over.
const MARGIN = 48;
const GUTTER = 24;

const WIDE = { width: 1920, height: 1080 };
const SQUARE = { width: 2048, height: 2048 };
const TALL = { width: 1080, height: 1920 };

function imageSlotId(index: number) {
  return `img-${index + 1}`;
}

function textSlotId(index: number) {
  return `text-${index + 1}`;
}

/// A row of equal panels across the page. `aspect` holds each panel to a shape
/// and centres the row vertically — a filmstrip is cinema frames on a page,
/// not four full-height columns.
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

/// A uniform grid, read left to right and top to bottom — which is the order
/// the slot ids are in, so an assignment that puts the opening image in `img-1`
/// puts it where a director's eye starts.
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

/// The spiral's boxes, before the gutter is taken out of them. Each step lays a
/// square against the short edge of what is left, which is what makes the
/// blocks shrink by the ratio rather than by an arbitrary step.
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

/// Tilted, overlapping instant photos. The angles are small and alternate in
/// sign: a scatter that leans one way reads as a page printed crooked.
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

/// One large image and a supporting column, the shape a look is usually pitched
/// in: this is the film, and these four are what else it is made of.
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

/// Two columns of unequal tiles. The stagger is in the heights rather than in a
/// vertical offset: offsetting a column runs its last tile off the page, and
/// what makes masonry read as masonry is that no two rows line up.
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

/// A magazine spread: headline across the top, a plate down the left, four
/// supporting images blocked to its right, one caption line under everything.
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

/// Full bleed and no gutters — the one layout where the page is the image and
/// the tiles are its parts. Mixed sizes so the eye is given somewhere to start.
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

/// The template's name as it is said out loud. The ids are shouted constants
/// because the model reads them; a director reading a caption under a board is
/// owed "Hero left" rather than `HERO_LEFT`.
export function layoutLabel(id: LayoutId) {
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

/// The smallest and largest board these templates can make. A director asking
/// for a board of one photo is asking for a photograph, and one of thirty is
/// asking for a contact sheet; both get clamped to the nearest template rather
/// than refused, because either way there *is* a board they meant.
export const LAYOUT_MIN_BLOCKS = Math.min(...MOODBOARD_LAYOUTS.map((l) => l.slots.length));
export const LAYOUT_MAX_BLOCKS = Math.max(...MOODBOARD_LAYOUTS.map((l) => l.slots.length));

/// `RANDOM`, resolved — before the model is called, so the compositor is never
/// asked to pick a template and then assign to it in the same breath.
///
/// The count decides it: a template is chosen by how many blocks are on offer,
/// clamped at the ends. Two templates hold six blocks and two hold seven, and
/// those ties are the only place chance comes into it — `pick` is injected so a
/// test can say which, and so a caller that wants the same board twice can.
export function resolveLayout({
  blockCount,
  requested,
  pick = Math.random,
}: {
  blockCount: number;
  requested?: unknown;
  pick?: () => number;
}): MoodboardLayout {
  const named = layoutById(requested);
  if (named) return named;

  const wanted = Math.min(
    LAYOUT_MAX_BLOCKS,
    Math.max(LAYOUT_MIN_BLOCKS, Math.floor(blockCount) || LAYOUT_MIN_BLOCKS),
  );
  const candidates = MOODBOARD_LAYOUTS.filter((layout) => layout.slots.length === wanted);
  /// Every count from the minimum to the maximum is covered by a template, so
  /// this cannot be empty — the fallback is here so a template removed from the
  /// table later degrades to a board rather than to a crash.
  if (candidates.length === 0) return MOODBOARD_LAYOUTS[0]!;

  const index = Math.min(candidates.length - 1, Math.floor(pick() * candidates.length));
  return candidates[Math.max(0, index)]!;
}

/// One slot as the model reads it. Not the coordinates: a model given four
/// numbers per slot spends its attention re-deriving what "large" means, and
/// spends our tokens doing it. Shape and share are the two facts an assignment
/// actually turns on — a portrait photo in a wide slot, a hero in a filler.
export type SlotBrief = {
  id: string;
  kind: SlotKind;
  shape: string;
  /// The slot's share of the page, as a percentage. This is what says hero from
  /// filler without the model having to measure anything.
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

/// A block on offer to the compositor: a reference to place, or a line of text
/// to set. The id is what comes back in the assignment, and for an image block
/// it is the reference id — which is what lets a cut and the photograph it came
/// out of be offered to the board on equal terms.
export type LayoutBlock = {
  id: string;
  kind: SlotKind;
  width?: number | null;
  height?: number | null;
  /// The words, for a text block. Ignored on an image block.
  text?: string | null;
};

export type SlotAssignment = { blockId: string; slotId: string };

export type Placement = { slot: LayoutSlot; block: LayoutBlock };

/// What the model's assignment actually amounts to, once it is held against the
/// layout and the blocks it was given.
///
/// Everything it got wrong is named rather than dropped: an id that is in no
/// list, a slot filled twice, a block placed twice, a photograph put in a text
/// slot. A board is built from what survives — five images placed and one
/// misfiled is a board with a hole in it, which is closer to what was asked for
/// than no board — and the report is what lets the orchestrator say so.
export type AssignmentPlan = {
  placed: Placement[];
  unknownBlocks: string[];
  unknownSlots: string[];
  /// Blocks it was offered and did not place. Not an error: choosing what does
  /// not make the board is half of what the compositor is for.
  unplaced: string[];
  /// An image block sent to a text slot, or the reverse.
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
    /// First one wins. A model that names the same slot twice has changed its
    /// mind halfway through a list it emitted in reading order, and the earlier
    /// answer is the one the rest of the list was written against.
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

/// A plan with the leftovers sat down in whatever room was left.
export type SeatedPlan = AssignmentPlan & {
  /// Blocks code put on the board because the compositor had not, and there was
  /// a free slot of their kind. Named so the answer can own it: the arrangement
  /// of these is not the compositor's judgement, it is reading order.
  seated: string[];
};

/// Every picture the director named, on the board, whenever the board has room.
///
/// Measured (iteration 15): asked to add a second photograph to a two-slot board,
/// the compositor placed one and left the other off — its instruction said a
/// board is a selection, and it read a 1.5 landscape as a poor fit for a 0.94
/// slot. On a *rebuild* that is not a selection, it is a deletion: the picture
/// was on the board a moment ago and the write takes it off.
///
/// So the model's judgement decides which block goes where, and code decides that
/// a block does not fall off a board with an empty slot on it. Surplus is still
/// surplus — a tenth photograph on a nine-slot grid stays unplaced, because there
/// is nowhere to put it.
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

  /// Completion, not substitution: a plan that placed nothing is a compositor
  /// that answered nothing usable, and filling the page in reading order would
  /// file a board nobody composed under a broken call nobody noticed.
  if (!plan.placed.length || !free.length || !leftover.length) return { ...plan, seated: [] };

  const placed = [...plan.placed];
  const seated: string[] = [];

  for (const block of leftover) {
    /// Reading order, and only into a slot of its own kind — the same rule the
    /// model is held to, since a line of text in an image slot is not a rescue.
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

/// The image's box inside its slot, at the photo's own aspect ratio and centred.
///
/// Contained rather than filled: excalidraw draws an image element by stretching
/// the bytes to the box, so a slot filled edge to edge is a photograph squashed
/// to a shape it was not shot at. A cut is how a photo gets *made* to fit a
/// slot, and that is agent 3's job — the board does not silently do it by
/// distortion. A reference with no recorded size takes the whole slot, which is
/// the same call the drop makes.
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

/// How much of a text slot's height the type fills. A slot is the block the
/// words live in, not the words' own box, so the size follows the slot rather
/// than the character count.
const TEXT_SLOT_FILL = 0.6;
export const LAYOUT_TEXT_MIN_FONT = 12;
export const LAYOUT_TEXT_MAX_FONT = 96;

export function slotFontSize(slot: LayoutSlot) {
  const size = Math.round(slot.height * TEXT_SLOT_FILL);
  return Math.min(LAYOUT_TEXT_MAX_FONT, Math.max(LAYOUT_TEXT_MIN_FONT, size));
}

/// The scene elements a plan comes to: excalidraw skeletons, in slot order, at
/// an origin on the canvas.
///
/// Image elements point at their reference the same way a dragged one does —
/// a `ref:` fileId the board load hydrates — so a composed board costs a pointer
/// per photo and the bytes stay in the bucket exactly once.
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
      /// Never `pending`: the file entry is a reference pointer the load
      /// rebuilds, so the element is complete the moment it lands. Same reason
      /// as the drop's.
      status: "saved" as const,
      ...box,
      x: rounded(origin.x + box.x),
      y: rounded(origin.y + box.y),
      ...(angle && { angle }),
    };
  });
}

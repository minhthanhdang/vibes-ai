import type { BoardItem, Rect } from "@/lib/boards/board-contents";
import type { ReadableShape } from "@/lib/canvas-objects/object-read";
import { pageItems } from "@/lib/pages/board-pages";

/// A page as *arrangement* (tech-spec §V.4's blocks).
///
/// `page-contents.ts` answers which pictures are on a page and in what order.
/// That is a list, and a list is what pages were introduced to stop being the
/// only way to read a board: "one page is one picture, so what the board looks
/// like — what sits beside what, at what size, cut off by which edge — can reach
/// the prompt. Nothing else in the prompt carries arrangement."
///
/// This is that reading. Every element on the page as a box, so a model can
/// answer "the big one on the left", "the two under the headline" and "put the
/// stairwell beside it" against the page rather than against a guess.
///
/// The box is §V.4's own format: `[ymin, xmin, ymax, xmax]`, normalized 0–1000
/// against the page rect, y-first. The same format Gemini returns boxes in and
/// the same one the crop rows are stored in, so this is a dialect the model is
/// already reading in this prompt rather than a second one it has to learn. Being
/// normalized is what lets a 1920×1080 page and a 2048×2048 one be described in
/// one vocabulary — "half the width" is 500 on both.
///
/// Two things are deliberately *not* here: the properties of the pictures (the
/// catalogue carries those, and a board read that restated them would buy the
/// same paragraph twice) and the render. §V.4's full representation is the
/// picture, the metadata and the properties together; this is the part that can
/// be computed from the scene alone.
///
/// No canvas, no React, no DOM.

/// Blocks described per page. §V.4's cap, and the catalogue's — a page holding
/// more than two dozen things is a page whose arrangement is not what the model
/// is missing. *Which* two dozen is `byReach` below, which is a separate
/// question and was the one being answered wrongly.
export const PAGE_BLOCK_CAP = 24;

/// A line on a page said back in full is a caption; said back in full when it is
/// three paragraphs the user pasted in is the page's text budget spent on one
/// block. Clamped, and marked as clamped, for the same reason the block count is.
const TEXT_CLAMP = 120;

/// `[ymin, xmin, ymax, xmax]`, 0–1000 against the page rect, y-first.
export type PageBox = [number, number, number, number];

type BlockBase = {
  box: PageBox;
  /// 0-100, absent at whole. On every kind rather than on the shape alone: a
  /// photograph faded to 40% is a scrim over the page and a reader told a
  /// picture sits there reads it as one at full strength — the same sentence
  /// the shape's own bullet has carried since §XI.5, on the kind §XI.2 names
  /// first.
  opacity?: number;
  /// Stacking order among the page's own elements, 0 at the back. Reading order
  /// is what the list is in; this is what a collage's overlap is, which reading
  /// order drops on the floor.
  z: number;
  /// The element runs over the page edge and is drawn cut off there. The box is
  /// the part of it the page shows, so without this a reader would take an
  /// overflowing picture for a small one sitting against the edge.
  clipped?: true;
};

export type PageBlock =
  | (BlockBase & {
      kind: "image";
      /// Null for an image naming nothing the project holds. Kept in the list
      /// rather than dropped: it is on the page taking up that room, and an
      /// arrangement with a hole where it sits reads as empty page.
      referenceId: string | null;
    })
  | (BlockBase & { kind: "text"; text: string; clamped?: true })
  | (BlockBase & {
      kind: "shape";
      shape: ReadableShape;
      /// A hex, or `"transparent"` for an outline with nothing behind it — the
      /// difference between a colour field and a border, and the difference
      /// between a block that hides what is under it and one that does not.
      fill: string;
      stroke: string;
    });

export type PageBlocks = {
  /// Reading order, the same order and the same rule `pageContents`' pictures are
  /// counted in — except that a reference placed twice is two blocks here, since
  /// two copies of one photograph are two things on the page.
  blocks: PageBlock[];
  /// Blocks the cap dropped — the smallest on the page (`byReach`), never a
  /// region of it. Counted rather than dropped silently: a cap that does not say
  /// what it dropped reads as coverage.
  omitted: number;
};

/// What a full page measures in the dialect every box on one is said in.
///
/// Exported because reading a box back the other way — a share of a page into
/// the pixels it stands for — is arithmetic a second module now does, and a
/// scale spelled 1000 in two files is a scale that can be changed in one.
export const PAGE_BOX_SCALE = 1000;

/// A coordinate on the page, as a share of it in thousandths.
///
/// Clamped to the page, which is what makes `clipped` load-bearing rather than
/// decorative: excalidraw draws a child cut off at its frame's border, so the
/// part of an overflowing picture past the edge is not on the page and a box
/// running to 1400 would describe a page bigger than the one being rendered.
function share(value: number, span: number): number {
  if (!(span > 0)) return 0;
  return Math.min(
    PAGE_BOX_SCALE,
    Math.max(0, Math.round((value / span) * PAGE_BOX_SCALE)),
  );
}

/// Exported for the canvas object read, which speaks the same dialect: a box on
/// a page is these four shares wherever a model is shown one.
export function pageBoxOf(item: Rect, page: Rect): PageBox {
  return [
    share(item.y - page.y, page.height),
    share(item.x - page.x, page.width),
    share(item.y + item.height - page.y, page.height),
    share(item.x + item.width - page.x, page.width),
  ];
}

/// Exported beside `pageBoxOf` and for the same reason: one clamp, one marker,
/// wherever a page's line is said back to a model.
export function clampedText(text: string): { text: string; clamped?: true } {
  const said = text.trim();
  if (said.length <= TEXT_CLAMP) return { text: said };
  return { text: `${said.slice(0, TEXT_CLAMP).trimEnd()}…`, clamped: true as const };
}

/// How far a block reaches across the page it is on, in the thousandths its box
/// is already quoted in — the longer of its two sides.
///
/// This is what the cap and the brief's character budget both spend in, and the
/// longer side rather than the area because a rule drawn across a page is a
/// `line` nine hundred wide and none high (`board-contents.ts`): 102 of the 905
/// blocks on this database have no area at all, so ranking by area would sort
/// every rule on a page below every caption. A hairline across a page is not a
/// small thing.
export function blockReach(box: PageBox): number {
  return Math.max(box[2] - box[0], box[3] - box[1]);
}

/// Which blocks are described when not all of them fit, as indices into the
/// list — the one that reaches furthest across the page first, and reading order
/// between two that reach the same distance, since the sort is stable.
///
/// Reading order is the order they are *said* in and was the order they were
/// *chosen* in until this database was asked what that costs. It runs top to
/// bottom, so a cap that keeps its first two dozen keeps a horizontal slice: on
/// the two densest pages here — 44 and 49 blocks, both agent 8's — the described
/// two dozen were 16 and 18 blocks from the top third, 8 and 6 from the middle,
/// and **none at all** from the bottom third that twelve blocks stand in. That is
/// the second look (compositor-v2.md §VIII) telling a design its page stops
/// halfway down, on the one ask whose standing flaw is a bare bottom third.
///
/// Spending by reach instead describes the whole rectangle: the same two pages
/// come out 7/7/10 and 9/7/8 across the thirds. What goes is the small print,
/// and the count says so.
export function byReach<T extends { box: PageBox }>(blocks: readonly T[]): number[] {
  return blocks
    .map((_, at) => at)
    .sort((one, other) => blockReach(blocks[other]!.box) - blockReach(blocks[one]!.box));
}

/// The page's elements as boxes on it, in reading order.
///
/// Shapes are here when the caller read them (`boardItems`' own `shapes`) and
/// they compete for the same two dozen blocks (§XI.5): a colour block is part
/// of the arrangement, and the cap already says what did not fit. A caller that
/// read pictures alone gets exactly the list it always got.
///
/// Takes the items that are *this page's* — `itemsOnPage` — not the board's: a
/// photograph in the overlap of two pages the user dragged together belongs
/// to the topmost of them (§V.3), and described in both arrangements it is a
/// position the model reads off a page nothing stands on.
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
    /// The renderer's own reading, defaulted the way the picture beside this
    /// text was drawn — never a second reader of the same columns (§XI.1).
    const style = item.style!;
    return {
      kind: "shape" as const,
      shape: item.shape!,
      fill: style.fill,
      stroke: style.stroke,
      ...common,
    };
  });

  /// Every block is built and then some are dropped, rather than the list being
  /// cut before it is read: which two dozen the cap keeps is a question about
  /// their boxes, and a box is what building one is.
  const kept =
    cap >= 0 && on.length > cap
      ? byReach(on)
          .slice(0, cap)
          .sort((one, other) => one - other)
          .map((at) => on[at]!)
      : on;

  return { blocks: kept, omitted: on.length - kept.length };
}

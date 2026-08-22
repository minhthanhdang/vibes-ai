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
/// is missing.
export const PAGE_BLOCK_CAP = 24;

/// A line on a page said back in full is a caption; said back in full when it is
/// three paragraphs the user pasted in is the page's text budget spent on one
/// block. Clamped, and marked as clamped, for the same reason the block count is.
const TEXT_CLAMP = 120;

/// `[ymin, xmin, ymax, xmax]`, 0–1000 against the page rect, y-first.
export type PageBox = [number, number, number, number];

type BlockBase = {
  box: PageBox;
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
      /// 0-100, absent at 100: a block at 30% is a scrim over the page rather
      /// than ground on it, and a reader not told so reads a wash as a colour.
      opacity?: number;
    });

export type PageBlocks = {
  /// Reading order, the same order and the same rule `pageContents`' pictures are
  /// counted in — except that a reference placed twice is two blocks here, since
  /// two copies of one photograph are two things on the page.
  blocks: PageBlock[];
  /// Blocks past the cap. Counted rather than dropped silently: a cap that does
  /// not say what it dropped reads as coverage.
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
  const on = pageItems(items, page);
  const kept = cap >= 0 ? on.slice(0, cap) : on;

  return {
    blocks: kept.map((item) => {
      const common = {
        box: pageBoxOf(item, page),
        z: item.z,
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
        ...(item.opacity !== undefined && item.opacity < 100 && { opacity: item.opacity }),
        ...common,
      };
    }),
    omitted: on.length - kept.length,
  };
}

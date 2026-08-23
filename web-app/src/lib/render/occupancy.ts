import type { Rect } from "@/lib/boards/board-contents";
import { drawnBounds, type RenderDraw, type RenderPlan } from "@/lib/render/render-plan";

/// How much of a page's frame the design actually stands on, band by band.
///
/// §VIII names free placement as a risk and says the only answer is to eyeball a
/// fixture set, because no test asserts taste. That stays true — this is not a
/// verdict and nothing here passes or fails. It is the smaller thing that makes
/// an eyeball verdict survive a second run: the repeatable flaw the first three
/// fixtures showed was every design leaving the bottom third of its page empty,
/// and "the bottom third is empty" is a number where "it looks unbalanced" is a
/// memory of a picture nobody still has.
///
/// Deliberately geometric and deliberately coarse. It reads the placement plan
/// rather than the pixels, so it needs no bucket, no fonts and no codec — the
/// same split `render-plan.ts` makes for the same reason.

/// Three, because the flaw being watched is a third of a page and because a
/// designer's own vocabulary for a frame is thirds (`composition`). Callers can
/// ask for more; nothing here assumes the default.
export const OCCUPANCY_BANDS = 3;

/// A draw covering this much of the frame is the ground rather than a thing
/// standing on it, and counting it would answer every question with "full".
/// A full-bleed backdrop is exactly what a design reaches for when it has
/// nothing to put at the foot of the page, so a metric it hides the flaw from is
/// worse than no metric.
export const BACKDROP_COVERAGE = 0.9;

export type OccupancyAxis = "y" | "x";

export type Band = {
  /// Where the band sits in the frame, as fractions of the axis.
  from: number;
  to: number;
  /// The share of *this band's* own area that anything is drawn on, counted as
  /// a union — two blocks stacked on the same spot cover it once.
  covered: number;
};

export type OccupancyRead = {
  axis: OccupancyAxis;
  bands: Band[];
  /// The union share of the whole frame, on the same content.
  covered: number;
  /// How many draws were read as ground and left out. Reported rather than
  /// silently dropped: a page whose only element is a backdrop reads as empty
  /// here and that is the right answer only if the count is visible beside it.
  backdrops: number;
};

export type OccupancyOptions = {
  axis?: OccupancyAxis;
  bands?: number;
};

/// The union area of a set of rectangles inside a window, by coordinate
/// compression: every edge becomes a grid line and a cell counts once if
/// anything covers its middle. Exact for axis-aligned boxes, and a page carries
/// tens of draws rather than thousands, so the quadratic cell count is cheaper
/// than the sweep that would replace it.
function unionArea(boxes: readonly Rect[], window: Rect): number {
  const inside = boxes
    .map((box) => intersect(box, window))
    .filter((box): box is Rect => box !== null && box.width > 0 && box.height > 0);
  if (!inside.length) return 0;

  const xs = axisLines(inside.flatMap(({ x, width }) => [x, x + width]));
  const ys = axisLines(inside.flatMap(({ y, height }) => [y, y + height]));

  let area = 0;
  for (let column = 0; column + 1 < xs.length; column += 1) {
    const left = xs[column]!;
    const right = xs[column + 1]!;
    const midX = (left + right) / 2;
    for (let row = 0; row + 1 < ys.length; row += 1) {
      const top = ys[row]!;
      const bottom = ys[row + 1]!;
      const midY = (top + bottom) / 2;
      const covered = inside.some(
        (box) =>
          midX >= box.x && midX <= box.x + box.width && midY >= box.y && midY <= box.y + box.height,
      );
      if (covered) area += (right - left) * (bottom - top);
    }
  }
  return area;
}

function axisLines(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function intersect(box: Rect, window: Rect): Rect | null {
  const x = Math.max(box.x, window.x);
  const y = Math.max(box.y, window.y);
  const right = Math.min(box.x + box.width, window.x + window.width);
  const bottom = Math.min(box.y + box.height, window.y + window.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/// Is this draw the page's ground rather than a thing standing on it — the one
/// rule, asked by everything that reads a plan geometrically.
///
/// It lives here because `BACKDROP_COVERAGE` does, and it is exported because
/// three readings now depend on agreeing about it and two of them had drifted:
/// the bands tested the clipped box, the margins tested the drawn one, and
/// `ink` did not ask at all. Measured on the 927 draws of this database the
/// first two rules never disagree, so the clipped one — what actually lands on
/// the page — is the one kept.
export function isBackdrop(plan: RenderPlan, draw: RenderDraw): boolean {
  const area = plan.width * plan.height;
  if (area <= 0) return false;
  const inside = intersect(drawnBounds(draw), {
    x: 0,
    y: 0,
    width: plan.width,
    height: plan.height,
  });
  if (!inside) return false;
  return (inside.width * inside.height) / area >= BACKDROP_COVERAGE;
}

export function bandOccupancy(plan: RenderPlan, options: OccupancyOptions = {}): OccupancyRead {
  const axis = options.axis ?? "y";
  const count = Math.max(1, Math.floor(options.bands ?? OCCUPANCY_BANDS));
  const frame: Rect = { x: 0, y: 0, width: plan.width, height: plan.height };
  const area = plan.width * plan.height;

  const boxes: Rect[] = [];
  let backdrops = 0;
  for (const draw of plan.draws) {
    const inside = intersect(drawnBounds(draw), frame);
    if (!inside) continue;
    if (isBackdrop(plan, draw)) {
      backdrops += 1;
      continue;
    }
    boxes.push(inside);
  }

  const span = axis === "y" ? plan.height : plan.width;
  const bands: Band[] = [];
  for (let at = 0; at < count; at += 1) {
    const from = at / count;
    const to = (at + 1) / count;
    const window: Rect =
      axis === "y"
        ? { x: 0, y: from * span, width: plan.width, height: (to - from) * span }
        : { x: from * span, y: 0, width: (to - from) * span, height: plan.height };
    const windowArea = window.width * window.height;
    bands.push({ from, to, covered: windowArea > 0 ? unionArea(boxes, window) / windowArea : 0 });
  }

  return {
    axis,
    bands,
    covered: area > 0 ? unionArea(boxes, frame) / area : 0,
    backdrops,
  };
}

/// The bands with next to nothing on them, named the way a person would say it.
/// Empty when the design stands on the whole frame, which is what makes it worth
/// printing unconditionally.
export function emptyBands(read: OccupancyRead, floor = 0.02): number[] {
  return read.bands.flatMap((band, at) => (band.covered <= floor ? [at] : []));
}

/// What a band is called, for a read a person is meant to act on. The article
/// comes with the name because only one of the two forms takes one — "the top
/// third" and "band 2 of 5", never "the band 2 of 5".
///
/// Thirds have names and nothing else does: a five-band read is a diagnostic
/// somebody asked for and numbering it is honest, where inventing words for
/// fifths would read as vocabulary this codebase has and it does not.
function bandName(read: OccupancyRead, at: number): string {
  const names =
    read.bands.length !== 3
      ? null
      : read.axis === "y"
        ? ["the top third", "the middle third", "the bottom third"]
        : ["the left third", "the middle third", "the right third"];
  return names?.[at] ?? `band ${at + 1} of ${read.bands.length}`;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/// The sentence a page tool puts in its text for how the page is standing.
///
/// A fact and never a verdict, for the reason §V.3 keeps instructions out of the
/// skills: a bare band is sometimes the design — a poster with its whole lower
/// half deliberately quiet is not a poster with a mistake in it — and a tool that
/// said "fill the bottom third" would be a taste argument arriving as though it
/// were a measurement. So this says only what is there, in the vocabulary the
/// foundations already use for a frame.
///
/// It exists because the second look is not catching this on its own (§VIII):
/// three runs of one ask came back at 2% / 34% / 0% and the design read its own
/// page afterwards and called it "generous margins and breathing room" — an
/// eyeball describing a page that is 88% white as roomy. The picture rides with
/// this text; the number is the part of it a model cannot talk itself out of.
///
/// **And it did not move the flaw.** The welcome sign with this sentence in its
/// `get_page` answer came back at 2% / 35% / 0%, 13% inked, and closed on
/// "generous margins" again — the fourth run of that ask to land in the same
/// place, after a skill paragraph (iteration 32) and an instruction correction
/// (iteration 31) had each already failed to move it. So this stays for what it
/// says rather than for what it was hoped to change, and the next attempt should
/// not be a fifth sentence: the model is not missing the fact, it is reading a
/// nearly empty page as the "room around it all" the ask asked for.
export function occupancyNote(read: OccupancyRead): string {
  const ground = read.backdrops
    ? `, not counting ${read.backdrops === 1 ? "a draw" : `${read.backdrops} draws`} covering the whole rectangle`
    : "";
  const bare = emptyBands(read);

  if (!read.bands.length || (bare.length === read.bands.length && read.covered <= 0)) {
    return `Nothing stands on this page yet${ground}.`;
  }

  const perBand = read.bands
    .map((band, at) => `${percent(band.covered)} of ${bandName(read, at)}`)
    .join(", ");
  const empty =
    bare.length && bare.length < read.bands.length
      ? ` Next to nothing stands in ${bare.map((at) => bandName(read, at)).join(" or ")}.`
      : "";

  return `Something stands on ${percent(read.covered)} of this page${ground}: ${perBand}.${empty}`;
}

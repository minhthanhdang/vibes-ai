import { normalizeHexColor } from "@/lib/analysis/analysis";
import type { Rect } from "@/lib/boards/board-contents";
import { drawnBounds, type RenderDraw, type RenderPlan } from "@/lib/render/render-plan";

/// What a line of type stands on, and whether it can be read there.
///
/// `compositor-v2.md` §IX.5's palette bullet has been asking for this reading
/// across four runs and could never take it. Its first two findings were about
/// the *list* — a headline reaching outside the five hexes — and that is a
/// colour a read can compare against a brief. Its third was not: `#415557` on
/// `#2c3234` is two members of the brief laid on each other, the palette held
/// perfectly and spent wrongly, and nothing about either hex on its own says so.
/// Contrast is a *pair*, so the only thing that can answer it is something that
/// knows which draw is behind which — which is `RenderPlan` and nothing else in
/// this codebase.
///
/// It reads the plan rather than the scene for the reason the geometry read
/// gives (`render-plan.ts` §III.2.1): the plan is the reader that has been
/// checked against excalidraw's own export, and z-order is already resolved
/// there with a page's children lifted into their own run. A second walk of the
/// element array would have to re-derive that order to get the ground right.
///
/// Nothing here is a verdict, for the reason `plan-read.ts` gives at length —
/// a strapline at 3.9:1 over a photograph's dark corner is a decision somebody
/// may have made on purpose. What it removes is the guesswork: iteration 27
/// measured three pages by hand and got a different answer unblended (nine
/// failing pairs) from blended (none), which is the kind of arithmetic nobody
/// should be doing twice.

/// WCAG 2.1 AA: 4.5:1 for body copy, 3:1 once the type is large. Both are here
/// because a page whose every headline is flagged is a reading nobody acts on —
/// the 96px line at 3.4:1 is legible and the 13px note beside it is not.
export const CONTRAST_BODY_MIN = 4.5;
export const CONTRAST_LARGE_MIN = 3;

/// WCAG's own 18pt, in the scene units a `fontSize` is stored in. Bold's lower
/// 14pt is deliberately not honoured: excalidraw has no weight axis, so every
/// line on this product is one weight and a second threshold would only ever
/// misread.
export const CONTRAST_LARGE_FONT = 24;

export type ContrastPair = {
  /// The text element's own id, so a flagged pair is a thing that can be
  /// selected on the board rather than a colour to go looking for.
  textId: string;
  /// The ink as it lands — its own hex blended down at its opacity, since a
  /// line at 40% is not the colour it stores.
  ink: string;
  /// What it stands on: every fill under it composited down to the page's own
  /// background, or that background when nothing is between them.
  ground: string;
  ratio: number;
  /// The size the pair is judged at, in scene units, and the ratio that size
  /// wants — the two numbers that say why a 3.2:1 passed here and failed there.
  fontSize: number;
  wants: number;
};

export type ContrastRead = {
  /// Pairs this could read. Type over a photograph is not one of them and is
  /// counted separately rather than dropped (invariant 7, at a reading rather
  /// than at a door).
  pairs: number;
  /// Type standing on a photograph, where the ground is pixels no plan holds.
  /// A design that puts every line over an image reads as `0 pairs` here, and
  /// that number is the finding rather than a clean page.
  overImage: number;
  /// The pairs that came in under what their size wants, worst first.
  failing: ContrastPair[];
  /// The lowest ratio on the page, whether or not it fails — the one number a
  /// run log can carry.
  worst: ContrastPair | null;
};

type Channels = [number, number, number];

function channels(hex: string): Channels {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as Channels;
}

/// sRGB relative luminance, WCAG's own formula.
///
/// Exported because `readableInk` asks the same question of a swatch label and
/// two implementations of one curve is how a palette chip and a page read as
/// different colours. Takes an already-normalised `#rrggbb`.
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  ) as Channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(ink: string, ground: string): number {
  const [lighter, darker] = [relativeLuminance(ink), relativeLuminance(ground)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/// `over` laid on `under` at `alpha`, in sRGB rather than linear light.
///
/// Wrong in physics and right here: it is what excalidraw's canvas and the
/// rasteriser both do, so a card the user is looking at is this colour and not
/// the one a gamma-correct blend would give.
export function blendColours(under: string, over: string, alpha: number): string {
  if (alpha <= 0) return under;
  if (alpha >= 1) return over;

  const [a, b] = [channels(under), channels(over)];
  const mixed = a.map((value, at) => Math.round((value * (1 - alpha) + b[at]! * alpha) * 255));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function centre(box: Rect): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function holds(box: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/// What a fill contributes, or null when it contributes nothing. `transparent`
/// is excalidraw's own default and the commonest value on the database, so the
/// walk below spends most of its time here.
function fillOf(draw: RenderDraw): { colour: string; alpha: number } | null {
  if (draw.kind !== "shape") return null;
  const hex = normalizeHexColor(draw.fill);
  if (!hex || draw.opacity <= 0) return null;
  return { colour: hex, alpha: draw.opacity };
}

type Ground = { colour: string; overImage: boolean };

/// What is behind a draw at its own centre, composited down to the background.
///
/// One sample point, deliberately. A headline lying half on a card and half off
/// it is two grounds and no single ratio, and picking the worse of the two would
/// flag the pages that most obviously work — the centre is where the eye lands
/// and where a design that meant the card put the words.
///
/// A line's or an arrow's path is ignored: nothing on this product is read
/// against a stroke, and treating a bent arrow's bounding box as ground would
/// put a colour behind type standing in the gap it encloses. Its *fill* needs
/// no rule of its own any more — the plan carries a colour only where the
/// picture paints one (`paintsInside`, `render-plan.ts`), so an open line
/// arrives transparent and a closed loop arrives with the paint it is drawn in,
/// read against its bounding box the way an ellipse's already is.
function groundUnder(plan: RenderPlan, at: number): Ground {
  const point = centre(drawnBounds(plan.draws[at]!));
  const layers: { colour: string; alpha: number }[] = [];

  for (let below = at - 1; below >= 0; below -= 1) {
    const draw = plan.draws[below]!;
    if (!holds(drawnBounds(draw), point)) continue;

    /// Type is not ground. Two lines crossing is a layout fault the occupancy
    /// read already names, and calling the lower one's ink a background would
    /// report it here as a contrast one.
    if (draw.kind === "text") continue;

    if (draw.kind === "image" && draw.opacity > 0) {
      return { colour: plan.background, overImage: true };
    }

    const fill = fillOf(draw);
    if (!fill) continue;
    layers.push(fill);
    if (fill.alpha >= 1) break;
  }

  const base = normalizeHexColor(plan.background) ?? "#ffffff";
  /// Collected top-down, composited bottom-up: the layer nearest the background
  /// is laid on it first and the one nearest the type is laid on last.
  const colour = layers.reduceRight(
    (under, layer) => blendColours(under, layer.colour, layer.alpha),
    base,
  );
  return { colour, overImage: false };
}

/// Every pair of type and ground on a page, and the ones that fail.
///
/// `plan.scale` is divided out for the reason `typeOf` divides it out: the
/// picture is capped, so a 96px line on a 1080-wide page and the same line on a
/// 2400-wide one arrive here as different numbers, and the threshold is in
/// scene units.
export function contrastRead(plan: RenderPlan): ContrastRead {
  const scale = plan.scale > 0 ? plan.scale : 1;
  const pairs: ContrastPair[] = [];
  let overImage = 0;

  for (let at = 0; at < plan.draws.length; at += 1) {
    const draw = plan.draws[at]!;
    if (draw.kind !== "text") continue;
    const ink = normalizeHexColor(draw.colour);
    if (!ink || draw.opacity <= 0 || !draw.text.trim()) continue;

    const ground = groundUnder(plan, at);
    if (ground.overImage) {
      overImage += 1;
      continue;
    }

    const fontSize = draw.fontSize / scale;
    const laid = blendColours(ground.colour, ink, draw.opacity);
    pairs.push({
      textId: draw.id,
      ink: laid,
      ground: ground.colour,
      ratio: contrastRatio(laid, ground.colour),
      fontSize,
      wants: fontSize >= CONTRAST_LARGE_FONT ? CONTRAST_LARGE_MIN : CONTRAST_BODY_MIN,
    });
  }

  const ranked = pairs.slice().sort((a, b) => a.ratio - b.ratio);
  return {
    pairs: pairs.length,
    overImage,
    failing: ranked.filter((pair) => pair.ratio < pair.wants),
    worst: ranked[0] ?? null,
  };
}

/// The read said out loud, or the empty string when there was no type to read.
export function contrastLine(read: ContrastRead): string {
  if (!read.pairs && !read.overImage) return "";
  const over = read.overImage ? `, ${read.overImage} over a photograph` : "";
  if (!read.worst) return `no type on ground this can read${over.replace(/^, /, ": ")}`;

  /// The two hexes and the size are said only when something failed, for the
  /// reason `typedIn` gives about the pixel figure: on a page that clears, the
  /// ratio is the whole reading and three more values on every line would bury
  /// the one line worth opening.
  const named = read.failing.length
    ? ` (${read.worst.ink} on ${read.worst.ground}, ${Math.round(read.worst.fontSize)}px)`
    : "";
  const failing = read.failing.length
    ? `${read.failing.length} of ${read.pairs} under what their size wants`
    : `all ${read.pairs} clear`;
  return `worst pair ${read.worst.ratio.toFixed(1)}:1${named}, ${failing}${over}`;
}

/// How many failing lines are named before the note starts costing more than it
/// buys. Three, because the note rides on every `get_page` of a page that has
/// one — and a design that has laid ten unreadable lines does not need ten of
/// them spelled out to know what it did.
export const CONTRAST_NOTE_LIMIT = 3;

/// The failing pairs, said to the agent that put them there (§VIII).
///
/// `contrastLine` above is a log row: one page, the worst ratio, a count, read
/// by whoever is holding the run output afterwards. This is the same reading
/// handed to the design while it can still act on it, and it differs in the
/// three ways a reader differs from a scoreboard.
///
/// **It is silent on a page that clears.** `occupancyNote` speaks every time
/// because where the work stands is a fact about every page; what cannot be
/// read is a fact about a few, and a sentence confirming the ordinary case
/// would ride on every round of every design. `undrawnNote` is quiet for the
/// same reason.
///
/// **It names only what the caller can address.** A bound label's ratio is as
/// real as any other line's, and its id is one every canvas door refuses by
/// name (`object-read.ts`, the label filter) — so pointing at one would hand
/// back the exact loop stage 0 closed, at a new door. What the caller filters
/// out is still *counted*: a total that moved with the caller would not be the
/// total `contrastLine` reports for the same page.
///
/// **It names the ratio each size wants.** `TYPE_FLOOR_NOTE` draws the
/// distinction and it holds here — a number the model has to *clear* is safe to
/// print where a number it can aim at is not, because 4.5 is a floor and no
/// design has ever been made worse by clearing it further.
export function contrastNote(read: ContrastRead, addressable?: ReadonlySet<string>): string {
  if (!read.failing.length) return "";

  const many = read.failing.length !== 1;
  /// The denominator is dropped when it is the whole page, because "4 of the 4"
  /// is a fraction a reader has to work out and "all 4" is the finding itself.
  const how =
    read.failing.length === read.pairs
      ? many
        ? `all ${read.pairs} lines of type on this page`
        : "the one line of type on this page"
      : `${read.failing.length} of the ${read.pairs} lines of type on this page`;
  const said = `${how} ${many ? "stand" : "stands"} too close in colour to what ${many ? "they are" : "it is"} laid on`;
  /// Capitalised because it is one sentence in a paragraph of them: the page's
  /// head line is `standingNote`'s sentence and then this one, joined by a
  /// space (`page-brief.ts`).
  const opening = said[0]!.toUpperCase() + said.slice(1);

  const named = read.failing
    .filter((pair) => !addressable || addressable.has(pair.textId))
    .slice(0, CONTRAST_NOTE_LIMIT);
  if (!named.length) return `${opening}.`;

  const pairs = named
    .map(
      (pair) =>
        `${pair.textId} is ${pair.ink} on ${pair.ground}, ${pair.ratio.toFixed(1)}:1 where ${Math.round(pair.fontSize)}px wants ${pair.wants}`,
    )
    .join("; ");
  const rest = read.failing.length - named.length;

  return `${opening}: ${pairs}${rest ? `; and ${rest} more` : ""}. Set ${many ? "them" : "it"} in a colour that separates from ${many ? "their" : "its"} ground with restyle_on_canvas, or change the ground ${many ? "they stand" : "it stands"} on.`;
}

/// Two of a palette's own colours, and how far apart they hold. Unordered: the
/// ratio is symmetric, so `#78a8a4` on `#2c3234` and the reverse are one fact
/// and saying it twice would spend a prompt's words on arithmetic.
export type PalettePair = { colours: [string, string]; ratio: number };

export type PaletteContrast = {
  /// Pairs that clear `CONTRAST_BODY_MIN`, widest first — the ones a caption or
  /// a paragraph can be set in.
  body: PalettePair[];
  /// Pairs that clear `CONTRAST_LARGE_MIN` and not the body threshold, widest
  /// first. Disjoint from `body` on purpose: a reader asking "what can carry a
  /// caption" and a reader asking "what can only carry a headline" are asking
  /// two different questions, and a superset answers neither.
  large: PalettePair[];
  /// The widest pair in the list, whether or not it clears anything — the one
  /// number that says how far a palette can be stretched at all.
  widest: PalettePair | null;
};

/// What a brief's colours can carry, before a page has been designed.
///
/// `contrastRead` answers this after the fact, off a finished page, and the
/// census it made cheap says two thirds of the failures were never the design's
/// to avoid: of 196 failing pairs on the database, 129 stood on a ground for
/// which the brief holds no legible ink at all, and one six-page lookbook's
/// five hexes have **no** pair over 1.95:1 — no page obeying that palette could
/// have carried a readable caption. That is not a page spending its colours
/// wrongly; it is a closed list with nothing in it to spend.
///
/// So the same arithmetic is taken one step earlier, over the list rather than
/// over the page, where it is worth something to the model that is about to
/// choose (`compositor-v2.md` §IX.3). Every hex is expected already normalised —
/// `vibesBrief` is the only caller and refuses a form that is not.
export function paletteContrast(palette: readonly string[]): PaletteContrast {
  const pairs: PalettePair[] = [];
  for (let at = 0; at < palette.length; at += 1) {
    for (let with_ = at + 1; with_ < palette.length; with_ += 1) {
      const colours: [string, string] = [palette[at]!, palette[with_]!];
      pairs.push({ colours, ratio: contrastRatio(colours[0], colours[1]) });
    }
  }
  pairs.sort((a, b) => b.ratio - a.ratio);
  return {
    body: pairs.filter(({ ratio }) => ratio >= CONTRAST_BODY_MIN),
    large: pairs.filter(({ ratio }) => ratio >= CONTRAST_LARGE_MIN && ratio < CONTRAST_BODY_MIN),
    widest: pairs[0] ?? null,
  };
}

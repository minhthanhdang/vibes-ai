import {
  BACKDROP_COVERAGE,
  bandOccupancy,
  emptyBands,
  type OccupancyOptions,
} from "@/lib/render/occupancy";
import {
  drawnBounds,
  type RenderDraw,
  type RenderPlan,
  type TextDraw,
} from "@/lib/render/render-plan";

/// What a design left on a page, as one operator's line.
///
/// §VIII answers "free placement can make an ugly page" with a fixture set that
/// is eyeballed, and iterations of that set kept producing the same argument in
/// two places: `npm run design:fixtures` measured what landed and
/// `npm run design:check` — the typed, one-off ask — did not, so any question of
/// the form "does this ask read differently from that one" could only be put to
/// the three pinned fixtures. The read lives here so both doors say it, in the
/// same words, and so the arithmetic under it is testable without a bucket.
///
/// Nothing here is a verdict. `occupancy.ts` says why at length: a bare band is
/// sometimes the design. This is the same fact said for a person reading a
/// terminal rather than for a model reading a tool answer.

export type PlanRead = {
  /// The frame's own size in scene units, which is the number the margins below
  /// are an argument about. Off `plan.frame` rather than `plan.width` — the
  /// picture is capped at `RENDER_MAX_DIMENSION`, so a 1920x1080 page and a
  /// 2400x1350 one are the same 1600-wide file and a log that reads the output
  /// size cannot tell them apart.
  ///
  /// It is here because of what a census of the board agent 8 has been designing
  /// on says: twenty-three pages made across every fixture run, and every one of
  /// them 1920x1080 or 1080x1920. Not one page of any other shape, including on
  /// the runs after §II.3 was corrected to say a page is the box it draws. The
  /// margins say the frame is wrong for the work; this says which frame, and it
  /// was invisible in every log this project has kept.
  shape: string;
  /// What landed, by draw kind rather than by element — the thing that tells
  /// two run logs apart before anybody opens the pictures. An outline is its own
  /// kind because §III.2 makes it a shape the model was *told* about rather than
  /// one it saw.
  landed: string;
  /// The share of the frame the drawn rectangles add up to, overlaps counted
  /// twice. Not a coverage figure and deliberately not the union — a stack of
  /// four blocks on one spot passes 100% here and that is the reading that says
  /// "everything is piled in one corner", which the union hides.
  ///
  /// Off `drawnBounds` like the bands and the margins, so the three numbers are
  /// about one rectangle each and `ink` can never come in under `covered`.
  ink: number;
  /// The band read, said the way somebody would say it out loud.
  standing: string;
  /// The union share of the frame, from the same read the bands come from.
  covered: number;
  /// How much of each edge nothing reaches, as a share of that axis — the
  /// bounding box of everything that is not ground, measured against the frame.
  margins: Margins;
  /// The margins, said the way somebody would say them out loud, or the empty
  /// string when the design reaches every edge.
  framed: string;
  /// How big the type is set, against the frame it is set in — null on a page
  /// with no text on it at all.
  type: TypeRead | null;
  /// The type read, said out loud, or the empty string when there is no type.
  typed: string;
};

export type Margins = { top: number; right: number; bottom: number; left: number };

/// The type sizes on the page as shares of the frame's height, and how many
/// distinct ones there are.
export type TypeRead = { largest: number; smallest: number; sizes: number };

const percent = (share: number) => `${Math.round(share * 100)}%`;

function landedIn(draws: readonly RenderDraw[]): string {
  const counted = new Map<string, number>();
  for (const draw of draws) counted.set(draw.kind, (counted.get(draw.kind) ?? 0) + 1);
  return [...counted].map(([kind, count]) => `${count} ${kind}`).join(", ") || "nothing";
}

/// Thirds have names here for the same reason they do in `occupancyNote`, and
/// past three the bands are numbered rather than given invented vocabulary.
function bandNames(count: number, axis: "y" | "x"): string {
  if (count !== 3) return `${count} bands`;
  return axis === "y" ? "top-middle-bottom" : "left-middle-right";
}

/// The margins the design left, which is the flaw the bands miss.
///
/// The three-band read cleared two of the three §VIII fixtures — the banner at
/// 7% / 53% / 7% and the spread at 14% / 68% / 4% named no band bare — and both
/// pictures show the same thing the welcome sign shows: a strip of content
/// floating in the middle of a frame a third taller than it needs. A band is
/// only bare when *nothing* reaches it, and one caption dipping into the bottom
/// third is enough to clear the floor while the other 29% of the page stays
/// white. The bounding box does not have that hole in it: it says how far the
/// work gets from each edge and it says it the same way whatever the ask was.
///
/// Ground is left out for the reason `bandOccupancy` leaves it out — a
/// full-bleed backdrop reaches every edge and would answer every page with
/// "no margins", which is the one answer that cannot be acted on.
///
/// What it said the first time all three fixtures were put through it, which is
/// the sharpest statement of §VIII's taste risk so far and the first one that
/// is the same sentence about all three:
///
///   welcome sign  1080x1920   nothing within 32% top, 39% bottom
///   banner        1920x1080   nothing within 28% top, 28% bottom
///   photo spread  1920x1080   nothing within 25% top, 29% bottom
///
/// A quarter to two fifths of the frame dead at each end, on every ask, and no
/// left or right margin over the floor on any of them. The design is not
/// misplacing its work — it is choosing a page a third taller than the work it
/// intends to put on it, and then centring. That is one flaw with one cause,
/// where the bands read as three unrelated numbers.
///
/// That reading has since been tested rather than argued. The banner ask, word
/// for word, run on a 1920x640 page made for it beforehand
/// (`npm run design:check -- --page-box`, which exists for this question):
///
///   given 1920x1080, its own choice   22% ink   7% / 53% / 7%   28% top, 28% bottom
///   given 1920x640, made for it       64% ink  59% / 75% / 59%  no margin over the floor
///
/// Same ask, same model, same three skills fetched. Handed a frame at the
/// proportion of the work, the design fills it edge to edge and leaves no margin
/// worth saying. So the placement was never the flaw and neither was the second
/// look: the whole of it is the box the design writes for its own page, and both
/// of the places that could have taught it already say the right thing — §II.3
/// tells it the proportion is its first design decision and that a banner is
/// long and short, and `banner-designer`, fetched on every one of these runs,
/// gives hero strips at 3:1 to 5:1. A sixth sentence has nowhere new to go.
///
/// Deliberately not in `occupancyNote` and so not in any tool's answer. Four
/// separate attempts have now put this fact in front of the model — an
/// instruction correction, a skill paragraph, the band read in `get_page`, and
/// the ask reworded — and none of them moved the page (§VIII, `occupancy.ts`).
/// A fifth sentence is not the next thing to try.
///
/// It was not a sentence. The sixth attempt took the two shapes *out* of the
/// instruction — §II.3's page paragraph printed "LANDSCAPE_HD 1920x1080,
/// PORTRAIT_HD 1080x1920" two lines above "the proportion is yours", and every
/// one of the twenty-three pages agent 8 had made was one of those two. With
/// the numbers gone from that paragraph and the names left on `resize_page`,
/// the banner ask came back on a page it wrote itself, twice running:
///
///   banner, numbers in the paragraph   1920x1080   22% ink   28% top, 28% bottom
///   banner, numbers gone (twice)       1920x600    60% ink   no margin over the floor
///
/// Which is the page `--page-box` had to hand it to get that read. The welcome
/// sign (1080x1920, 13%, 33% and 38%) and the spread (1920x1080, 28%, 26% and
/// 29%) did not move, and that is the size of the result: what the anchor was
/// holding was the one ask whose right shape is nowhere near a preset. The
/// other half of the anchor was in every transcript — `resize_page`'s
/// declaration gives the same three sizes in pixels — and agent 8 now reads a
/// fork of it that does not (`DESIGNER_RESIZE_PAGE`), leaving agent 6's own
/// untouched. No declaration and no line of the instruction gives a page size
/// in pixels any more, and both pins are held by tests.
///
/// That settles the anchor question and not in the anchor's favour. The welcome
/// sign, run twice with every number gone, came back at 1080x1920 / 13% ink /
/// 33% top, 38% bottom — the baseline exactly — and `design:check`'s argument
/// print says why it cannot be the board underneath it either: the model wrote
/// `box: [0, 55000, 1920, 56080]` itself, which is PORTRAIT_HD to the pixel,
/// rather than putting a page with no box and inheriting the last one's shape.
/// It reproduces the preset from its own prior with nothing in front of it to
/// read it off. So the shape decision is not a lever the prompt has left.
///
/// What that run does show is that this ask's frame is not the flaw the banner's
/// was. Four lines of type, no picture, and the boxes are `[330, 200, 365, 800]`
/// and the three under it — a headline 3.5% of the page tall on a sign meant to
/// be read across a room. A 9:16 door sign is a defensible rectangle; type set
/// that small in it is not, and it is a different failure from the banner's
/// wrong frame. `visual-hierarchy` carries the scale-against-the-frame paragraph
/// and is fetched on every one of these runs, so it is not an unread one either.
///
/// One correction since those numbers were taken, and it does not move them:
/// every rectangle here is now `drawnBounds` rather than the element's own box,
/// so a headline set wider than the box it was written into is measured where
/// the picture draws it. It changes 19 of the 38 pages in the development
/// database by a point or two, and one of them by a whole edge.
function marginsOf(plan: RenderPlan): Margins {
  const area = plan.width * plan.height;
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;

  for (const draw of plan.draws) {
    const box = drawnBounds(draw);
    if (area > 0 && (box.width * box.height) / area >= BACKDROP_COVERAGE) continue;
    top = Math.min(top, box.y);
    left = Math.min(left, box.x);
    bottom = Math.max(bottom, box.y + box.height);
    right = Math.max(right, box.x + box.width);
  }

  /// A page with nothing standing on it is all margin, which is the true answer
  /// and the one a caller can print beside "nothing".
  if (!Number.isFinite(top)) return { top: 1, right: 1, bottom: 1, left: 1 };

  const share = (value: number, span: number) =>
    span > 0 ? Math.min(1, Math.max(0, value / span)) : 0;
  return {
    top: share(top, plan.height),
    right: share(plan.width - right, plan.width),
    bottom: share(plan.height - bottom, plan.height),
    left: share(left, plan.width),
  };
}

/// Only the edges worth saying, and only past a margin a designer would have
/// chosen on purpose. A tenth of the frame is a margin; a third of it is the
/// page being the wrong size for the work on it.
const MARGIN_FLOOR = 0.1;

function framedIn(margins: Margins): string {
  const said = (["top", "right", "bottom", "left"] as const)
    .filter((edge) => margins[edge] >= MARGIN_FLOOR)
    .map((edge) => `${percent(margins[edge])} ${edge}`);
  return said.length ? `nothing within ${said.join(", ")}` : "";
}

/// The other half of the §VIII flaw, which the four reads above cannot see.
///
/// The shape read settled the banner: handed the numbers back, the design wrote
/// itself a 1920x600 strip and filled it. It did not move the welcome sign, and
/// the run that proved the anchor was dead is also the one that says why — the
/// page came back at 1080x1920, which is a defensible rectangle for a door
/// sign, with four lines of type on it and the topmost at `[330, 200, 365,
/// 800]`. Thirty-five thousandths: a headline set at 3.5% of the height of a
/// sign meant to be read across a room. The margins call that page "nothing
/// within 33% top, 38% bottom" and the bands call it "0% bottom bare", and both
/// sentences are about where the type sits. Neither is about how small it is,
/// and on this ask the size is the whole of it — nothing else would have to
/// move if the type were three times bigger.
///
/// So the two §VIII failures the metrics have merged for six iterations are a
/// wrong frame and a wrong scale inside a right one, and the second has never
/// had a number. It does now, and it is the same shape of number as the first:
/// a share of the frame, said whatever the ask was, printed beside the others.
///
/// Off `fontSize` rather than `drawnBounds` on purpose. The set rectangle grows
/// with the wording — three lines at the same size are three times the box —
/// so a box read cannot tell a large headline from a long paragraph, which is
/// exactly the distinction being asked about. `fontSize` is scaled by the same
/// factor the boxes are, so dividing by the picture's own height gives the
/// share of the frame without ever reaching for `plan.scale`.
///
/// The step is here for the same reason the count is: `visual-hierarchy`, which
/// every one of these runs fetches, is largely about the distance between the
/// sizes on a page, and a design with four lines all at one size has made a
/// decision worth being able to see in a log. Like everything else in this
/// file it is a reading rather than a verdict — a poster with one type size is
/// a poster, and there is no floor here that says otherwise.
///
/// What it says over every page on the development database, which is the free
/// census `npm run design:pages` now takes rather than three iterations writing
/// it by hand — 41 pages, 32 of them with type on them:
///
///   largest type, share of the frame   median 5%   min 2%   max 10%
///   31 of the 32 under 8%; the one over is the frame somebody else sized
///   step between largest and smallest  median 1.5x, 5 pages set at one size
///
/// The one page over 8% is the 1920x640 banner `--page-box` handed the design in
/// iteration 35. Every page it chose the frame for itself sets its biggest type
/// under a twelfth of that frame, and the two ends of the range are the two
/// asks: a welcome sign at 5% of a 1080x1920 sign, an album spread at 2–3% with
/// its one caption and no second size at all.
///
/// The banner ask is the reading that says what this is. Three frames, one ask:
///
///   1920x1080, its own choice before the anchor went   4% of the frame — 43px
///   1920x600, its own choice after                     7% of the frame — 42px
///   1920x640, handed to it by `--page-box`            10% of the frame — 64px
///
/// The share moved and the type did not. Two of those three pages are the same
/// headline at the same absolute size in frames of different heights, so the
/// design is not scaling type against the page it just chose — it is writing a
/// box at a size that would be reasonable on a screen. The third moved because
/// somebody else made the page, which is the same result `--page-box` got for
/// the frame.
///
/// And unlike the frame there is no number to take away: the sizes across all
/// 32 pages are continuous, 22px through 110px with no cluster anywhere near
/// excalidraw's own 16/20/28/36 presets, because text is fitted to the box
/// `put_on_canvas` is given and the box is written per page. Iteration 36's
/// lever does not have an analogue here, which is worth knowing before the next
/// attempt reaches for one.
function typeOf(plan: RenderPlan): TypeRead | null {
  const sizes = plan.draws
    .filter((draw): draw is TextDraw => draw.kind === "text")
    .map(({ fontSize }) => fontSize)
    .filter((size) => size > 0);
  if (!sizes.length || plan.height <= 0) return null;

  /// Rounded to the whole output pixel before they are counted as distinct: two
  /// text elements a scaled hair apart are one size to anybody looking at the
  /// page, and a count that says otherwise is noise from the downscale.
  const distinct = new Set(sizes.map((size) => Math.round(size)));
  return {
    largest: Math.max(...sizes) / plan.height,
    smallest: Math.min(...sizes) / plan.height,
    sizes: distinct.size,
  };
}

function typedIn(type: TypeRead | null): string {
  if (!type) return "";
  const step = type.smallest > 0 ? type.largest / type.smallest : 1;
  const spread =
    type.sizes > 1 ? `${type.sizes} sizes, ${step.toFixed(1)}x apart` : "one size throughout";
  return `largest type ${percent(type.largest)} of the frame, ${spread}`;
}

export function planRead(plan: RenderPlan, options: OccupancyOptions = {}): PlanRead {
  const read = bandOccupancy(plan, options);
  const bare = emptyBands(read);
  const named =
    read.bands.length === 3
      ? read.axis === "y"
        ? ["top", "middle", "bottom"]
        : ["left", "middle", "right"]
      : read.bands.map((_, at) => `band ${at + 1}`);

  const area = plan.width * plan.height;
  const ink = area
    ? plan.draws.reduce((sum, draw) => {
        const box = drawnBounds(draw);
        return sum + box.width * box.height;
      }, 0) / area
    : 0;

  const standing = [
    `${read.bands.map(({ covered }) => percent(covered)).join(" / ")} ${bandNames(read.bands.length, read.axis)}`,
    read.backdrops ? `${read.backdrops} backdrop` : "",
    bare.length ? `${bare.map((at) => named[at]).join(" and ")} bare` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const margins = marginsOf(plan);
  const type = typeOf(plan);
  return {
    shape: `${Math.round(plan.frame.width)}x${Math.round(plan.frame.height)}`,
    landed: landedIn(plan.draws),
    ink,
    standing,
    covered: read.covered,
    margins,
    framed: framedIn(margins),
    type,
    typed: typedIn(type),
  };
}

/// The whole read on one line, for the log of a single ask. `design:fixtures`
/// prints the same fields over two lines because it tabulates them afterwards;
/// a one-off ask has nothing to line up with and reads better whole.
export function planReadLine(read: PlanRead): string {
  return `${read.shape}, ${read.landed}, ${percent(read.ink)} of the page inked, standing on ${read.standing}${read.framed ? `, ${read.framed}` : ""}${read.typed ? `, ${read.typed}` : ""}`;
}

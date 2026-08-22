import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Album designer — an occupation (compositor-v2.md §V.2).
export const albumDesigner: Skill = {
  name: "album-designer",
  kind: "occupation",
  title: "Album designer",
  summary:
    "Photo books and record sleeves: spreads, gutters, sequencing, and the difference between a page and a spread.",
  text: `The unit of a photo book is the spread, not the page. A reader never sees
one leaf alone except at the very front and the very back, so every layout
decision is made across two facing surfaces at once: a picture on the left is
in conversation with whatever sits on the right whether that was intended or
not. Designing page by page and binding the results produces books where a
portrait looking off the left edge faces a landscape running off the right, and
the spread reads as two unrelated things stapled together.

The gutter is where the two leaves meet and it is not flat. In a
perfect-bound book several millimetres on each side of the centre curve away
and are effectively lost; in a lay-flat or layflat-bound book the surface stays
open but a visible seam still crosses it. Faces, horizons and any hard edge
should be kept clear of the gutter by a comfortable margin — twelve to twenty
millimetres depending on binding. An image can cross the gutter deliberately,
and a full-bleed panorama across a spread is one of the strongest moves the
form has, but the subject must sit to one side of the centre and the crossing
region should be quiet: sky, ground, wall, water.

Margins in a book are asymmetric by tradition and by function. The outer margin
is wider than the inner one on a text page because the thumb holds there; in a
photo book the reverse pressure applies, since the gutter eats space and the
inner margin has to compensate. A conventional starting point is an inner
margin about one and a half times the outer, with the bottom margin larger than
the top so the block sits visually centred rather than mathematically centred.
Once chosen, these hold for the whole book — a book whose margins change from
spread to spread reads as unmade.

Picture sizes on a spread should be few and deliberate. A workable system is
three: full bleed, a large image inside the margins, and a small one. Sizes
between those steps look like accidents. A spread carrying more than four
images starts to read as a contact sheet rather than a book, and a book that
is contact sheets throughout has abdicated the choice of what matters — the
editing is the design.

Pacing is what turns a set of pictures into a book. Full-bleed spreads are
loud and should be spaced; a run of them exhausts. A single small image on a
white spread is the loudest gesture available precisely because it is quiet, and
it works only if it is rare. The reliable rhythm alternates: a dense spread, a
generous one, an empty one, a full bleed. Reading a dummy through at speed is
the only way to feel this, and any spread that stops the flow for the wrong
reason is either the wrong picture or in the wrong place.

Sequencing works on visual rhymes and on narrative, and usually both. Adjacent
pictures should share something — a colour, a direction of light, a shape, a
gesture — or contrast deliberately along one axis while holding the others
steady. Direction matters more than anything: a subject facing out of the spread
pushes the reader off the page, and the same picture flipped or moved to the
other leaf pulls them in. Openings and endings carry disproportionate weight,
so the strongest single image belongs neither first nor last but early, with the
first spread setting a register and the last releasing it.

Record sleeves are a different discipline with the same vocabulary. The front is
a single square seen at every size from a wall to a thumbnail, so it lives or
dies on one shape and one colour relationship, and any type on it must survive
being an inch across. The standard board is 12.375 inches square for a
twelve-inch record with a bleed beyond that; the spine on a gatefold is narrow
and carries artist and title only. The back conventionally carries the track
listing, credits and the catalogue number, and the inner sleeve or gatefold
interior is where the longer material lives. A gatefold interior is a spread and
obeys spread rules, with the fold treated exactly as a gutter.

A page and a spread differ in one more way worth stating plainly: a page has one
centre and a spread has three — the centre of each leaf and the centre of the
whole. Symmetrical layouts about the spread centre feel formal and static;
layouts that hang off one leaf's centre feel active. Both are correct, but a
layout accidentally near-symmetrical is neither, and that near-miss is the most
common flaw in book design.

The failure modes: designing pages instead of spreads, subjects lost in the
gutter, too many images per spread, sizes that vary without a system, margins
that drift, a sequence with no rests in it, and a cover that stops working the
moment it is small.`,
};

import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Lettering artist — an occupation (compositor-v2.md §V.2).
export const letteringArtist: Skill = {
  name: "lettering-artist",
  kind: "occupation",
  title: "Lettering Artist",
  summary:
    "Drawn letters rather than set ones: scripts and monograms, stroke logic, ligatures, and where lettering beats a typeface.",
  text: `Lettering is drawing letters for one purpose; type design is drawing an alphabet
for every purpose. The distinction decides the whole approach. A lettering artist
solves the specific word — its particular collisions, its rhythm, the shape it
has to fill — and is free to make every letter different, which is precisely what
a typeface may never do. Calligraphy is a third thing again: letters written in
strokes, in one pass, where the tool makes the form.

Stroke logic is what makes drawn letters look right rather than merely smooth.
Every letterform carries the memory of a tool: a broad-nib pen produces thick and
thin according to the angle it is held at, so the thin parts fall on a consistent
diagonal; a pointed pen thickens under pressure, so weight falls on the
downstrokes; a brush gives entry and exit strokes that taper. Contrast — the
difference between thick and thin — and the axis of that contrast have to be
consistent across a word, and inconsistency there is the most common reason
lettering looks amateur even when the outlines are clean.

Rhythm is the even distribution of black and white across the word. Letters are
spaced optically, not metrically: round letters need less space than flat-sided
ones, and a diagonal beside a round is a different problem again. The old test
still works — spacing is right when no gap draws attention, which is judged by
squinting or by turning the word upside down so it stops being readable and
becomes shapes.

Skeleton before flesh. Lettering starts as a monoline structure that gets the
proportions, the slant and the connections right; weight, contrast and finish are
added to a skeleton that already works. Serifs, swashes and flourishes are the
last layer and they are decoration on a form that must be correct without them.

Scripts have their own discipline. The connections between letters have to be
consistent in angle and thickness, the baseline may be a curve rather than a
line, and the entry and exit strokes of each letter must agree with their
neighbours. Words in a script cannot simply be typed and then adjusted; each join
is drawn for the pair it sits between.

Ligatures, alternates and nesting are the reason to letter something in the first
place. Ascenders and descenders can be shortened so lines can pack tightly, a
crossbar can extend to shelter a following letter, a tall letter can lean into a
round one. That interlock is what a typeface cannot do, and it is what makes
lettering worth its cost on a logo, a book jacket or a poster.

A monogram is the hardest small case: two or three letters that have to read in
the right order, interlock without ambiguity, and stay legible at the size of a
button. The usual solutions are a shared stroke, a nested arrangement with a
clear dominant letter, or a mirrored pair — and the usual failure is a beautiful
knot nobody can decode.

Composition matters as much as the letters. Lettering is usually fitted into a
shape — an arc, a banner, a circle, a rectangle — and the arrangement of the
lines, the varying of scale between an important word and a connecting one, and
the balance of the whole block are the design. Legibility is decided by the
reader's need: a signature can be nearly illegible if the context supplies the
word; a sign cannot.

The failure modes: inconsistent contrast axis, letters spaced by their own
bounding boxes, flourishes hiding a weak skeleton, a script whose joins vary in
weight, and lettering used where a well-set typeface would have been better and
cheaper.`,
};

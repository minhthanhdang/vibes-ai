import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Concept artist — an occupation (compositor-v2.md §V.2).
export const conceptArtist: Skill = {
  name: "concept-artist",
  kind: "occupation",
  title: "Concept artist",
  summary:
    "Design for production: sheets and callouts, silhouette reads, orthographic conventions, and exploration before rendering.",
  text: `Concept art is design work whose output is instruction, not illustration. Its
audience is a modeller, a fabricator, a costume department or an art director,
and the question it answers is how something is built and why it looks the way it
does. That makes clarity the governing value: a beautiful painting that leaves
the back of an object undescribed has failed at the job, and a plain, well
organised sheet that answers every question has succeeded.

Exploration comes before resolution, always, and in volume. The standard method
is silhouette exploration — dozens of black shapes made quickly, judged only on
whether they read as distinct and interesting at thumbnail size — followed by
selection, then variation on the survivors, then internal division, and only then
rendering. The silhouette test is the whole discipline in miniature: filled solid
black, a design must be identifiable and unmistakable for any other design in the
same set. Anything that depends on interior detail to be recognised will not read
in motion, at distance, or in the medium it is destined for.

Shape language carries meaning and is chosen deliberately. Angular, spiky forms
read as threatening, fast, aggressive; rounded forms read as friendly, soft,
harmless; rectilinear forms read as stable, industrial, institutional. A design
usually picks one dominant shape family and admits a second as an accent, and a
cast or a set of props reads as a family when they share that language and vary
within it. Proportion carries meaning the same way: an exaggerated ratio between
head and body, or between a machine's mass and its supports, is a statement about
what the thing is, and the first pass of any design should push these ratios
further than feels reasonable so the middle can be found afterwards.

The three-value read is a practical check applied throughout. A design broken into
a light, a mid and a dark should show a clear pattern with an obvious focal
region, and the proportions of those areas should be unequal — roughly a
dominant, a supporting and a small accent. A design where light and dark are
evenly split has no focus and no hierarchy, and adding colour will not create
one.

A concept sheet is a layout with conventions. The hero view — the three-quarter
view, at a size larger than everything else — anchors the sheet and establishes
the design. Around or below it sit the orthographic views: front, side and back,
drawn at one consistent scale, aligned on shared horizontal guides so a shoulder
in the front view sits at the same height in the side view, and drawn without
perspective so measurements can be taken off them. A top view is added where the
form is not obvious from the other three. Callouts — enlarged details with a
leader line back to the point they describe — cover anything the main views
cannot show: a mechanism, a fastening, a material join, a section through a
thickness. A scale reference, a human figure or a familiar object at the same
scale, belongs on any sheet where absolute size matters, and it is the single
most frequently omitted element.

Sheets carry supporting material as well. A colourway strip shows the design in
its variants side by side at small size. A material or callout key names surfaces
in plain words. A back view is not optional: the back is what is seen for most of
a production and is the part most often left undesigned. Where a thing moves or
transforms, a small sequence of states does the explaining that no single view
can.

The layout of the sheet itself follows ordinary page discipline. A neutral mid-grey
ground rather than white or black, because both extremes lie about the design's
values. A consistent margin and a grid so views align. Generous space between
groups, and labels small and quiet — the drawing is the content and a heavy
caption competes with it. One sheet answers one question: a character, a vehicle,
a set of props. A sheet that mixes three subjects makes none of them findable.

Consistency across a set is what makes concept work usable. One light direction
for every view on a sheet and ideally across the whole set, one scale, one
palette, one level of finish. Views lit differently cannot be compared, and
comparison is what the sheet exists for.

The failure modes are specific and repeated: rendering before the silhouette
works, detail sprayed evenly so nothing is emphasised, a design that only reads
from its hero angle, orthographic views drawn with perspective in them so no
measurement can be taken, no scale reference, no back view, and decoration
mistaken for design — surface pattern and greebling added to a shape that was
never interesting to begin with.`,
};

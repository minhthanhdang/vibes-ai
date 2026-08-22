import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Visual hierarchy — a foundation (compositor-v2.md §V.2).
export const visualHierarchy: Skill = {
  name: "visual-hierarchy",
  kind: "foundation",
  title: "Visual hierarchy",
  summary:
    "How the eye is led — size, weight, contrast and position, and what first, second, third means on a page.",
  text: `Hierarchy is the order things are seen in, and it exists whether or not
anyone decided it. A layout where nothing was ranked still gets ranked by the
viewer, using whatever happens to be biggest or darkest, and the result is
usually not what the piece is about. The work is deciding what should be seen
first, second and third — three levels is normally the whole of it — and then
making the differences between those levels obvious enough that no one has to
look twice.

First, second, third is a specific claim. First is the one thing a viewer
should carry away if they look for a second and nothing else: a couple's names,
an offer, a title, a face. Second is what makes the first useful — a date, a
subtitle, a place. Third is everything that is only read once the first two
have done their work: body text, details, small print. A piece with two firsts
has no first. A piece with five levels has none that are distinguishable,
because each step has to give up some of the difference that made it readable.

Size is the loudest lever and the one that runs out fastest. Doubling something
makes it first; making it four times larger does not make it more first, it
just leaves less room. The useful discipline is that the jump between levels
must be unmistakable — a headline twenty per cent larger than the text below it
looks like an error rather than a heading — while the total range stays within
what the frame can hold.

Weight and contrast do the same job without taking space. A bold word in a
paragraph of regular text is read first no matter where it sits. Value contrast
against the ground is stronger still: black on cream outranks mid-grey on
cream, and the palest element on a page will be read last however large it is.
This is why a hierarchy that fails when the design is squinted at or converted
to greyscale is a hierarchy that depends on colour alone, and colour is the
weakest of the levers — a red word among black ones is noticed, but a bold one
is noticed sooner.

Position is a lever because reading has a direction. The upper left is where
the eye lands in left-to-right cultures, the lower right is where it leaves,
and the centre of a frame is a strong position that overrides both when it is
isolated. Something placed at the top is presumed important; something placed
at the bottom is presumed to be a footnote, which is a real cost for anything
that is not one. Proximity assigns meaning as strongly as position: an element
sitting nearer to one thing than another is read as belonging to it, so a
caption placed midway between two photographs belongs to neither.

Isolation outranks size. A small element with a large amount of empty space
around it will be seen before a large element crowded by neighbours, because
the eye is drawn to difference and an isolated thing is different from
everything else on the page. This is the cheapest hierarchy available and the
one most often skipped, because it costs area that feels wasted until the piece
is looked at from a distance.

Grouping is what turns a hierarchy into a structure. Elements close together
read as one unit and are ranked as a unit; the gap between groups must be
clearly larger than the gaps inside them, or the groups dissolve. The common
failure is even spacing everywhere, which produces a page that is tidy and
unreadable because it says everything belongs equally to everything else. The
matching failure is a heading with more space below it than above, which
visually attaches it to the section before rather than the one it names.

Repetition creates ranks. When the same treatment — size, weight, colour,
spacing — is used for every element of a kind, a viewer learns the system after
two examples and can then skim the rest by rank alone. Breaking the treatment
for one element promotes it, which is useful exactly once; a second break
destroys the system that made the first one legible.

Hierarchy has to be checked at the distance and size the piece is really seen
at. A sign read from three metres, a banner glimpsed while scrolling and a page
held at arm's length have different thresholds, and everything below the
threshold is not third-level information but invisible information. The test
that catches most failures is squinting until detail disappears: whatever is
still readable is the actual first level, and if that is not the intended one
the levers have been applied to the wrong element.

Hierarchy also decides what may be left out. When a first level is not landing,
the reflex is to enlarge it and the better move is usually to remove or demote
what is competing with it. Every additional element on a page takes attention
from the one that matters, and a piece with a clear first level and less on it
almost always outperforms a fuller one with the same headline.`,
};

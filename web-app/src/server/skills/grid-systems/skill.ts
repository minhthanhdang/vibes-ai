import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Grid systems — a foundation (compositor-v2.md §V.2).
export const gridSystems: Skill = {
  name: "grid-systems",
  kind: "foundation",
  title: "Grid systems",
  summary:
    "Columns, modules, baseline grids, margins and gutters, and why a grid is a decision made once.",
  text: `A grid is a set of decisions about position made once, so that they do not
have to be made again for every element. That is the whole argument for it.
Without one, each placement is a fresh judgement and the judgements will not
agree with each other; with one, alignment is automatic and the effort moves to
the decisions that are actually interesting. A grid is scaffolding, not a
result, and no viewer should be able to see it.

The parts are few. Margins are the space between the content and the edge of
the frame. Columns are the vertical divisions content is set into, and gutters
are the gaps between them. A module is what appears when horizontal divisions
are added as well, turning columns into a field of cells. Flowlines are the
horizontal lines elements hang from, and a page usually has two or three that
matter — the top of the content, the line the main image starts at, the line
the footer sits on.

Margins are structural, not leftover. A generous margin makes a piece look
confident and expensive; a thin one makes it look crowded whatever is inside
it. Unequal margins are a legitimate and often better choice than equal ones: a
larger bottom margin than top is the classical book proportion and stops the
content from looking as though it is sliding off the page, and an asymmetric
outer margin creates a place for captions, notes and page numbers to live.
Anything that runs to the edge — a bleeding photograph, a full-width band —
should do so decisively, because a photograph stopping two millimetres short of
the trim looks like a mistake and touching it looks like a decision.

Column count decides flexibility. Two columns is simple and rigid; three allows
a two-plus-one split; four allows halves and quarters. Twelve is the common
choice for interfaces because it divides by two, three, four and six, so a
layout can be halves on one row and thirds on the next without any element ever
losing its alignment. More columns is not more structure — it is more
permission, and a twelve-column grid used with no restraint produces the same
chaos as no grid at all. The count matters less than that every element spans a
whole number of columns.

Gutters set how strongly the columns read as separate. A narrow gutter makes
two columns of text run together; a wide one separates them so clearly that a
rule between them becomes unnecessary. The relationship worth holding is that
the gutter should be visibly smaller than the margin, because if the space
between columns matches the space at the edges the content stops reading as a
block and starts reading as a scatter.

Horizontal divisions are the half of a grid most often left undecided, and it
shows in the result. Columns get chosen carefully and the height is then
filled from the top down until the content runs out, which is how a layout
ends up with its work in the upper rows and a band at the foot belonging to
nothing. Dividing the height into rows the way the width is divided into
columns — three or four bands, each with a job and one of them the foot —
makes the bottom of the frame a place rather than what is left over. Where
there is a lot of height and little content the answer is usually fewer and
taller rows rather than the same rows and a gap: an arrangement occupying two
bands of four was designed for a shorter frame, and either the frame or the
arrangement is wrong.

A baseline grid extends the same idea vertically: every line of text sits on
one of a set of evenly spaced lines, and the spacing is derived from the body
text's leading. Everything else on the page — headings, images, spaces between
sections — is then sized in whole multiples of that unit. What this buys is
text in adjacent columns lining up line for line, and vertical rhythm that
holds across a whole document. What it costs is freedom, and it is worth the
cost on long documents and mostly not worth it on a single sign or a banner.

Spacing scales are the lighter version of the same discipline and they apply
everywhere. Choosing a base unit and using only multiples of it — 4, 8, 16, 24,
32 rather than 5, 13, 22, 30 — makes every gap on a piece a relative of every
other gap. Arbitrary spacing is the most common reason a layout that looks
correct in every part looks unresolved as a whole.

Breaking the grid is a technique, not a failure, and it depends on the grid
being established first. One element pushed deliberately out of the column
structure — an image that bleeds where nothing else does, a pull quote hung
into the margin — becomes the focal point precisely because everything around
it is aligned. Two or three such breaks and there is nothing left to break
against.

Grids are made to be responsive to the frame. A three-column arrangement in a
wide frame becomes one column in a narrow one, and the decision that carries
over is not the column count but the margin ratio and the spacing unit. What
should survive a change of size is the proportional relationships; what changes
is how many things sit side by side.

Not every piece wants a grid. A poster built around one photograph and three
words, or a piece whose subject is disorder, can be composed by eye and by
optical alignment alone. Even then the underlying habits hold: consistent
spacing units, deliberate margins, and elements that align with something. A
layout where nothing aligns with anything else reads as an accident, and the
grid is only the cheapest way of making sure that never happens.`,
};

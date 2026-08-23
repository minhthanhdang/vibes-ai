import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Textile designer — an occupation (compositor-v2.md §V.2).
export const textileDesigner: Skill = {
  name: "textile-designer",
  kind: "occupation",
  title: "Textile Designer",
  summary:
    "Cloth and pattern: repeats and layouts, scale and colourways, woven against printed, and how a pattern behaves in use.",
  text: `Textile design makes pattern and cloth, and it differs from every flat graphic
discipline in one way that changes everything: the design has no edges. It
continues, it is cut arbitrarily, it drapes, and it is seen both close up and
across a room.

The repeat is the core technical craft. A block repeat tiles straight across and
down and is the simplest, at the cost of visible rows and columns. A half-drop
shifts each column vertically by half a tile and is the workhorse, because it
breaks the horizontal banding the eye finds first. A brick repeat does the same
horizontally. A mirror repeat produces symmetry and a strong, formal effect.
Whichever is used, the tile must be seamless at every edge and — more difficult —
must not produce accidental structure when tiled: unintended diagonals, alleys of
empty ground, or a cluster that reads as a face are only visible when several
tiles are laid together, which is why a repeat is always checked at multiple
tiles and at reduced size rather than as a single square.

Layout is how motifs are distributed inside the repeat. Tossed layouts scatter
motifs at varied angles and read as informal; set layouts place them on a visible
grid and read as ordered; stripes and checks are structural and behave very
differently when cut on the bias. Density decides the ground: a pattern where
ground and motif are balanced reads quite differently from one where the ground
dominates, and the amount of visible ground is what determines whether a pattern
can be lived with over a large area.

Scale is a decision about distance and application. A small motif reads as a
texture from two metres away and effectively becomes a solid colour; a large one
is a statement and will be cut through by seams, cushions and furniture. The same
artwork at three scales is three products, and testing at the true size of use is
the only reliable check.

Colourways make a pattern into a range. The design is separated into a small
number of colours, and each colourway keeps the same value relationships while
changing hue — which is what lets one drawing serve a light, a dark and a bright
version. Value structure has to survive the swap, or one colourway will lose its
motif entirely. Print processes constrain the count: traditional screen printing
uses one screen per colour, so a design with fewer colours is cheaper and
registers better, and digital printing lifts the limit but not the discipline.

Woven and printed are different design problems. In a woven cloth, pattern is
structure — the interlacing of warp and weft — which limits what can be drawn but
gives texture, reversibility and durability. Print sits on the surface of a
finished cloth and can do anything the process allows, but a print can crock,
fade or crack, and it never has the depth of a weave. Knit is a third case again,
with stretch that distorts any pattern applied to it.

The cloth itself is half the design: fibre, weight, weave and finish decide
drape, sheen, how a colour reads and whether the fabric is suited to upholstery,
curtains or a garment. A pattern designed without the substrate in mind usually
looks wrong on it.

The failure modes: a repeat whose seams show, unintended diagonals or holes
across tiles, scale chosen at screen size rather than use size, a colourway that
loses the value structure, too many colours for the process, and a design that
ignores how the cloth will be cut and hung.`,
};

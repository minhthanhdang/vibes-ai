import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Depth and space — a foundation (compositor-v2.md §V.2).
export const depthAndSpace: Skill = {
  name: "depth-and-space",
  kind: "foundation",
  title: "Depth and Space",
  summary:
    "The third dimension on a flat surface: overlap, scale, perspective, atmospheric depth, figure and ground, and layers.",
  text: `Depth on a flat surface is an illusion assembled from a small number of cues, and
knowing them individually is what makes it controllable. They can be used
together for realism, used selectively for a stylised space, or deliberately
withheld to make an image read as flat.

Overlap is the strongest and cheapest cue. Anything that interrupts the outline
of something else is in front of it, and that reading is immediate and
unambiguous. It is also why a composition where nothing overlaps looks like a
diagram: separated elements sit on one plane no matter what else is done to them.

Relative size is the second. Two things known to be similar in size read as near
and far when drawn at different scales, and a strong difference in scale between
foreground and background is what gives a picture its sense of distance. Position
in the frame supports it: on a ground plane, higher usually means further away,
which is why a horizon line organises an entire image.

Linear perspective is the systematic version of the same idea. Parallel lines
converge at vanishing points on a horizon that is always at the viewer's own eye
level, which is the fact that decides whether a scene is seen from above, below
or straight on. One-point perspective is frontal and formal; two-point gives a
corner view and is the everyday case; three-point adds vertical convergence and
is used looking up or down. Foreshortening is the same rule applied to a form
turning away.

Atmospheric perspective is depth by contrast rather than by geometry. Distance
puts air between the eye and the subject, so far things lose contrast, lose
saturation, lighten and shift toward the colour of the sky — and their edges
soften. Reversing that — making the distance darker and sharper than the
foreground — flattens an image instantly. This is the most reliable way to build
depth without drawing a single converging line.

Focus and edge quality do the same job optically. A sharp subject against a soft
background separates by depth of field; hard edges advance, soft edges recede,
and controlling which edges are crisp is a way of controlling where the viewer
believes the picture's plane is.

Layering is the practical organisation of all this. Composing in three registers
— foreground, middle ground, background — gives an image somewhere to stand, a
subject, and a world behind it. A foreground element, even a dark out-of-focus
shape at the edge, does more for depth than any amount of detail in the distance,
because it establishes that there is space in front of the subject as well as
behind it.

Figure and ground is the other half of spatial reading. The eye assigns one shape
as object and the rest as space, and it does so by enclosure, size, contrast and
convexity. A composition where that assignment is ambiguous is unsettling, which
can be intentional; a composition where the negative space forms shapes as
interesting as the positive one is the mark of a considered design. Space between
elements is a shape and should be looked at as one.

On a flat layout the same cues govern the sense of layers: overlap, drop shadows
with a consistent light direction, blur, and scale. Consistency is what makes
them work — shadows falling in different directions, or elements that overlap in
contradictory orders, destroy the spatial reading immediately.

Flatness is a legitimate choice rather than a failure. Removing overlap,
perspective and value gradation produces a surface that reads as design rather
than as a window, and the strongest work is usually decisive about which of the
two it is, rather than mixing shallow depth cues that neither describe a space
nor commit to a plane.`,
};

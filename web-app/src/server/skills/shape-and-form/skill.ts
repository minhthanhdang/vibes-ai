import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Shape and form — a foundation (compositor-v2.md §V.2).
export const shapeAndForm: Skill = {
  name: "shape-and-form",
  kind: "foundation",
  title: "Shape and form",
  summary:
    "The primitives and what they connote, angular against rounded, geometric against organic, silhouette, and one shape family per piece.",
  text: `Everything on a page is a shape before it is a thing. A photograph is a
rectangle, a headline is a dark bar, a figure is a silhouette, a button is a
lozenge — and the eye reads those shapes and their arrangement before it reads
a single one of them as content. Shape is therefore a language that speaks
first, and a piece whose shapes were never chosen is speaking it anyway, in
whatever dialect its parts happened to arrive in.

The three primitives carry stable meanings. Circles read as friendly, soft,
complete, unthreatening — the shape of faces, suns and wheels — which is why
badges, portholes and profile pictures are round. Squares and rectangles read
as stable, reliable, rational, institutional: the shape of buildings, screens
and paper, the default container that disappears as a choice precisely because
it is everywhere. Triangles read as directional and sharp — energy, danger,
movement — and their meaning turns with their orientation: resting on a base
they are the most stable shape there is, balanced on a point the least. These
readings arrive before culture and style refine them, and a mark, a frame or a
layout built on one primitive inherits its temperament.

Corners are the same vocabulary at a smaller scale. A sharp corner reads as
precise, formal, technical, serious; a rounded one as friendly, casual, safe,
contemporary; a fully rounded end as soft to the point of playful. The radius
is a voice, and it is one of the most commonly inconsistent decisions in a
layout — cards at one radius, buttons at another, an image frame at a third —
which a viewer registers as untidiness without being able to name it. One
radius, or one small family of radii derived from each other, is a decision
made once, like a palette.

Geometric against organic is the wider register. Geometric shapes — ruled
lines, perfect arcs, true circles — read as engineered, modern, deliberate,
machine-made. Organic shapes — blobs, torn edges, hand-drawn contours, the
outlines of leaves and bodies — read as natural, human, warm and imperfect on
purpose. Neither is better; they are temperatures, and the mix sets the tone
as surely as colour does. A single organic shape in a geometric layout reads
as the living thing in the machine, and it is the shape equivalent of the one
saturated accent in a muted palette. Equal amounts of both read as indecision.

Silhouette is how a form is recognised. The outline does the identifying and
the interior detail only confirms it, which is why the classic test is to fill
a form with black and see whether it still says what it is. A mark, a product,
a figure or a letterform that survives the test reads at any size and against
any ground; one that depends on its interior falls apart small. The same test
grades an outline's quality: a silhouette with a few confident convexities
reads as strong, one with many small concavities and slivers reads as busy and
gets worse the smaller it is drawn. Simple silhouettes scale; complicated ones
have a minimum size.

A piece coheres when its shapes belong to one family. A dominant shape,
established once and echoed — the arch of a doorway repeated in the crop of a
photograph and the top of a text block, the circle of a mark repeated in a
badge and a bullet — is one of the quietest and strongest unifying devices
available. The echo does the work at any strength; the failure is the shape
that appears exactly once, which reads as an accident, where twice reads as a
decision. Contrast of shape is then a deliberate lever on top of the family: a
single round element among rectangles is seen first, for the same reason any
break in a pattern is, and it spends its force in one use.

Containers style what they hold. The same photograph in a hard rectangle, a
circle, an arch or a torn-edge mask is four different pieces: the rectangle is
neutral and editorial, the circle makes a badge or a portrait of it, the arch
quotes doorways and altars and reads as classical or sacred, the torn edge
reads as scrapbook and memory. A container shape is the cheapest way to put a
period or a mood onto an image without touching the image — and the most
commonly overdone, because a page of mixed container shapes has no family
left to read.

Weight belongs to shape as much as to colour. A filled shape is heavier than
the same shape outlined; a stroke gets lighter as it thins until it is a wire.
Solid and outline versions of one shape read as siblings — emphasis and rest
states of the same idea — which is a hierarchy that costs nothing. And mass
has posture: a wide low shape sits, a tall narrow one stands, a tilted one
falls, and a layout's stability is the sum of the postures in it.`,
};

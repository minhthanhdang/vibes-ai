import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Photographer — an occupation (compositor-v2.md §V.2).
export const photographer: Skill = {
  name: "photographer",
  kind: "occupation",
  title: "Photographer",
  summary:
    "How photographs are made, and therefore how they should be chosen and cut: focal length, light, and the frame's own decisions.",
  text: `A photograph is a set of decisions already made — where to stand, what lens,
what aperture, what moment, where to put the edges — and reading those decisions
backwards is what makes it possible to choose one photograph over another and to
cut one without ruining it. A picture is not a rectangle of content that can be
resized at will; it is an argument, and most of the ways it gets used break the
argument.

Focal length decides the relationship between things, not just how much fits in.
A wide lens, roughly 16 to 35 millimetres in full-frame terms, pushes the
background away and exaggerates the distance between near and far, which is why
wide interiors look spacious and wide portraits distort a face. A normal lens
around 50 millimetres renders proportions close to how they are perceived. A
short telephoto, 85 to 135, compresses depth, flattens features flatteringly and
separates a subject from a background that is now both closer and softer. A long
telephoto stacks planes together until a distant hillside sits behind a head like
a painted flat. The consequence for use: a wide photograph carries its context
and is ruined by a tight crop that removes the space it was made for, while a
telephoto portrait is already isolated and crops well.

Aperture governs how much is sharp, and depth of field is a compositional
instrument rather than a technicality. A wide aperture leaves a shallow band of
focus and everything else falls away, which directs attention absolutely and
irreversibly — nothing in post can make the background matter again. A small
aperture holds everything sharp and hands the ordering of the picture back to
composition and light. A photograph with a shallow plane of focus has a subject
declared by the maker; cropping such a picture around a different element
produces a photograph whose visual emphasis and whose subject disagree.

Light is the material. Its direction, quality, and colour describe a photograph
better than its content does. Front light flattens and reveals; side light
carves shape and texture and is what makes a face or a landscape look
three-dimensional; back light separates a subject from its ground with a rim and
turns everything in front into silhouette or haze. Hard light from a small
source gives crisp black-edged shadows and drama; soft light from a large one
gives gradual shadows and calm. The hour after sunrise and before sunset gives
warm, low, raking light with long shadows; overcast gives a huge soft source and
low contrast, which is forgiving and dull in equal measure; midday sun overhead
is the least useful light there is for people.

Colour temperature is set at the moment of capture, and two photographs lit
differently do not sit together comfortably however well they are composed. A
warm tungsten interior next to a cool overcast exterior reads as a mistake even
when both pictures are good. Choosing a set to sit together is largely choosing
by light — the same direction, the same hardness, the same temperature — and only
then by subject.

The frame's own decisions are the ones most easily undone. Where the maker put
the edge determines what the picture is about; a subject placed off centre with
space in front of it is a picture about anticipation, and centring that subject
in a crop makes it a picture about the subject alone. The horizon's height sets
how much the picture is about the ground or the sky. The angle of view — below
eye level, at it, above it — sets the relationship to the subject and cannot be
changed afterwards at all.

Cutting a photograph well means cutting along its own logic. Preserve the space a
moving or looking subject was given; do not cut through a joint — an ankle, a
wrist, a knee — because the eye reads the cut as amputation, and cut mid-limb
instead; keep the horizon out of the exact middle unless the symmetry is the
point; and change the aspect ratio only when the picture has room to spare on the
axis being shortened. A wide picture forced into a tall shape almost always loses
its subject's context. Where a specific ratio is required and the photograph will
not give it, the honest answer is a different photograph rather than a worse
crop.

Choosing among similar frames comes down to a short list: whether the light is
doing something, whether the subject is separated from its background, whether
the moment is complete — an expression fully arrived rather than halfway — and
whether the edges are clean, with nothing important cut and no bright distraction
at the border. Sharpness matters least of these and is checked last, because a
sharp picture of nothing is still nothing.`,
};

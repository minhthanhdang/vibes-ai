import "server-only";
import type { Skill } from "@/server/skills/skill";

export const colourGrading: Skill = {
  name: "colour-grading",
  kind: "foundation",
  title: "Colour grading",
  summary:
    "The finishing pass — tonal range, casts and split toning, named looks, and how one grade makes assembled pieces read as one image.",
  text: `A grade is a treatment applied over a finished image, and it is a different
job from choosing a palette. The palette decides which colours a piece is made
of; the grade decides how every colour already in the frame is bent — darker or
lifted, warmer or cooler, pulled toward one cast or left alone. Correcting and
grading are the two halves of the pass and they run in that order: correction
makes an image true — neutral whites, honest exposure, matched pieces — and the
grade then makes it deliberate. A look laid over an uncorrected image bakes the
faults in with the style, which is why a grade that is not working is usually a
correction that never happened.

The tonal range is the first set of decisions. The black point and the white
point say whether the image touches true black and true white or stops short of
them, and stopping short is a look in itself: lifted blacks — shadows that
bottom out at a soft grey — read as faded, filmic, nostalgic, while crushed
blacks read as punchy, modern, commercial. The contrast curve between those
ends decides the character in the middle. A gentle S — shadows slightly
deepened, highlights slightly brightened — is the invisible default that most
images want; a flattened curve reads as matte and editorial; a steep one reads
as loud. Where the mid-tones sit sets the overall brightness, and an image
whose whole range huddles in the middle reads as muddy however good its colour
is.

A cast is a single temperature laid across the whole frame, and it is the
strongest unifying device a treatment has. Warm casts — toward amber and gold —
read as nostalgic, domestic, late in the day. Cool casts — toward blue and
steel — read as clinical, urban, early, sad. A cast works because light in the
world really does colour everything it touches at once, so a frame that shares
one cast reads as one moment even when its contents never met.

Split toning is the refinement: one colour pushed into the highlights and a
different one into the shadows. Warm highlights over cool shadows is the
classic, because it repeats what sun and sky do to a real scene. Teal and
orange is the commercial cinema default — skin tones sit in the orange range,
so pushing shadows toward teal sets every face against its complement — and it
is recognisable enough that using it quotes the multiplex. Sepia into the
highlights over soft blacks quotes the archive. Whatever the pair, the two
tones do the work; a third makes mud.

Looks are named because their decisions travel together. A film emulation is
lifted blacks, gently compressed highlights, muted greens, a little grain and a
warm drift all at once — taking two of those and not the rest produces
something that quotes nothing. Bleach bypass is desaturation with raised
contrast, hard and metallic. Cross-processing is casts that disagree on purpose,
green shadows under yellow highlights. High-key commercial is lifted mid-tones,
clean whites and saturation kept polite. A matte look is the flattened curve
with the lifted black. Naming the look before grading is what keeps a
treatment from becoming a pile of adjustments.

For work assembled from pieces, the grade is what makes the pieces stop being
pieces. Photographs from different sources arrive with different black points,
different temperatures and different saturations, and a viewer reads the
mismatch as collage even when the layout is seamless. The order of repair is
tonal first — bring the value ranges together, since the eye reads value before
hue — then temperature, then saturation, and then one shared treatment over
everything. A single cast over all the pieces is the light-handed version; a
duotone or a full monochrome is the sledgehammer, and it works precisely
because it deletes every colour difference at once, which is also what it
costs.

What a grade cannot do is repair light. An image exposed into crushed shadows
has nothing in them for a lift to recover; pieces lit from opposite sides still
disagree after any amount of shared toning, because direction is not a colour.
The grade sits at the end of the chain and inherits everything before it.

Restraint is measured on skin. Faces are where a viewer's tolerance for
treatment runs out first — a cast that flatters a landscape turns skin grey or
jaundiced well before the rest of the frame complains — so a grade is pushed
until the faces object and then backed off. The matching failure at the other
end is the grade that becomes the subject: when the first thing seen is the
treatment rather than the image, the look has taken over, and a strong look
over weak content advertises the weakness.`,
};

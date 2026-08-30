import "server-only";
import type { Skill } from "@/server/skills/skill";

export const lightAndShadow: Skill = {
  name: "light-and-shadow",
  kind: "foundation",
  title: "Light and shadow",
  summary:
    "Key and fill, hard and soft, direction and quality of light, and what light does to mood.",
  text: `Light does three jobs at once: it says what shape a thing is, where it is in
space, and how the whole scene should feel. Form is read almost entirely from
the gradient between a lit surface and a shadowed one, which is why a subject
lit flatly from the camera's own position looks like a cut-out — there is no
gradient left to read the volume from — and why the same subject lit from one
side reads as solid.

The parts of a lit form are worth naming because they are the parts that go
wrong. The highlight is where the surface faces the light directly. The
mid-tone is the surface turning away. The core shadow is the darkest band, just
past the point where the surface stops receiving direct light, and it is
usually darker than the shadow beyond it. Reflected light bounces back into the
shadow from surfaces nearby and keeps it from going dead. The cast shadow is
what the form throws onto whatever is behind or beneath it, and it is the only
one of these that says where the form sits in the space. Cast shadows are
darkest and sharpest where they touch the object and soften as they travel.

Key and fill is the whole vocabulary of studio lighting in two words. The key
is the dominant light and it sets the direction; the fill is a weaker light,
usually near the camera, that opens the shadows without changing the direction.
The ratio between them decides the mood. A close ratio — fill nearly as strong
as key — gives an even, gentle, commercial look. A wide ratio gives deep
shadows, drama, and a subject that looks carved. Adding a rim or back light
behind the subject separates it from the background and is what makes a figure
read as being in front of a scene rather than pasted on it.

Hardness is a property of the light's apparent size, not its brightness. A
small source relative to the subject — the sun on a clear day, a bare bulb, a
phone torch — gives hard light: sharp shadow edges, high contrast, texture
picked out cruelly. A large source relative to the subject — an overcast sky, a
window with a curtain, a bounced light — gives soft light: gradual shadow
edges, low contrast, texture smoothed. Moving a source closer makes it larger
relative to the subject and therefore softer, which is why the same lamp is
harsh across a room and flattering at arm's length.

Direction changes the meaning more than intensity does. Front light flattens
and reassures. Side light describes texture and form and is the workhorse.
Light from above is the natural condition and reads as ordinary; light from
below is the condition almost nothing in nature produces and reads as uncanny
or theatrical. Back light hides detail and produces silhouette and rim, which
is atmospheric and unhelpful when the subject's detail matters. Three-quarter
light — the source above and off to one side — is the standard portrait
position because it produces a triangle of light on the shadowed cheek and
describes the face's structure without dividing it in half.

Colour and light are the same subject. Light has a temperature: candle and
tungsten are warm and orange, midday sun is neutral, open shade and overcast
skies are cool and blue, and a shadow lit only by the sky is bluer than the lit
surface beside it. That warm-light-cool-shadow relationship is one of the most
reliable cues that a scene is real, and its opposite — cool light with warm
shadows, as in firelight in a blue evening — is a strong effect precisely
because it is the inversion. A scene lit by two temperatures at once, warm from
one side and cool from the other, has depth and interest that a single-source
scene does not.

Contrast decides mood in the round. High key — bright, low contrast, shadows
lifted — reads as light, optimistic, airy, clean. Low key — dark, high
contrast, most of the frame in shadow — reads as serious, intimate,
mysterious, expensive. The failure at either end is the same: high key without
any dark accent anywhere looks washed out, and low key without any true
highlight looks muddy. Both want a full range present even when the bulk of the
image sits at one end of it.

Atmosphere is light travelling through something. Haze, dust, mist and distance
scatter light, so far objects lose contrast, lose saturation and shift toward
the colour of the sky. That single relationship — nearer means darker, more
saturated and more contrasted — creates depth in a flat image more convincingly
than perspective does, and it is what makes a landscape read as deep.

For composed work, the light in the pieces being assembled has to agree.
Photographs lit from opposite sides, or one hard and one soft, sit together
badly however well they are arranged, because a viewer reads them as belonging
to different worlds without being able to say why. Shadows are the tell: two
elements on the same surface throwing shadows in different directions is the
most visible inconsistency there is, and matching direction and hardness
matters more than matching colour.`,
};

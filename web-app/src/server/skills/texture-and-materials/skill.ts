import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Texture and materials — a foundation (compositor-v2.md §V.2).
export const textureAndMaterials: Skill = {
  name: "texture-and-materials",
  kind: "foundation",
  title: "Texture and Materials",
  summary:
    "Surface: grain and weave, stock and finish, weight and wear, what a material does to colour, and texture at the size seen.",
  text: `Texture is the character of a surface, and it does three jobs: it tells the eye
what something is made of, it holds attention where smoothness would not, and it
carries associations — of cost, of age, of care — faster than form or colour can.

Two kinds are worth distinguishing. Tactile texture is real surface a hand could
feel: the tooth of paper, the weave of cloth, an embossed edge, brush marks.
Visual texture is the appearance of surface on a flat plane: grain, halftone,
noise, a photograph of a material. Both work in an image, but only one survives
being photographed or printed, and a design that relies on tactile quality has to
be judged in the hand.

Every material has a set of properties that decide its behaviour: how much light
it reflects and how tightly, how absorbent it is, how it takes colour, how it
weathers. The most useful control is sheen. Matt surfaces scatter light, look
soft, hide flaws and read as natural or understated. Gloss surfaces reflect,
deepen colour, look clean and industrial, and show every imperfection. Satin sits
between them, and a composition where everything shares one sheen reads as flat
regardless of its colours — contrast of finish is as real as contrast of tone.

Paper is the material most design decisions actually meet. Coated stock holds ink
on the surface, giving sharp detail and saturated colour; uncoated stock absorbs
it, softening detail and dulling colour by a noticeable amount, which is why the
same file printed on both looks like two designs. Weight and bulk are felt before
anything is read. Tinted, recycled and handmade papers put their own colour under
every ink, and the paper's shade is effectively an extra colour in the palette.

Materials change colours placed on them. A hue on warm cream paper, on cool white
stock, on raw timber and on black card is four different colours; a saturated
pigment on an absorbent surface loses saturation; a colour under gloss gains
depth. Value contrast, not hue, is what survives across substrates.

Scale is the property most often mishandled. A texture has an inherent size, and
whether it reads as texture, as pattern or as noise depends entirely on how far
away it is seen and how large it is reproduced. Fine grain that gives a
photograph life at page size becomes coarse and dirty when enlarged, and a bold
weave shrunk down turns into an even grey. Any texture should be judged at the
size and distance it will actually be seen.

Wear is information. Patina, fading, scratching at the edges, dirt in recesses,
polish where hands touch — these say how old a thing is and how it has been used,
and their absence is what makes new objects and rendered images look sterile.
Deliberate distress is convincing when it follows use: worn where something is
handled, faded where light falls, not applied evenly.

Association is strong and consistent enough to be relied on. Unbleached and rough
surfaces read as honest, natural and inexpensive. Smooth, heavy, tightly finished
surfaces read as expensive. Foil, emboss and deep impression read as ceremonial.
Plastic gloss reads as commercial and contemporary. These readings can be played
against — luxury in raw materials is a deliberate move — but they cannot be
ignored.

Restraint is the general rule. One or two textures with a large quiet area to sit
against will always read better than a surface where everything is textured;
texture without contrast becomes noise, and noise is the point at which a surface
stops describing a material and starts obscuring the design.`,
};

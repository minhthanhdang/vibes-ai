import "server-only";
import type { Skill } from "@/server/skills/skill";

export const colourTheory: Skill = {
  name: "colour-theory",
  kind: "foundation",
  title: "Colour theory",
  summary:
    "Hue, value and saturation; harmony schemes; warm and cool; how a palette carries mood and what a limited one buys.",
  text: `Colour is three quantities, not one. Hue is where it sits on the wheel —
red, orange, teal. Value is how light or dark it is. Saturation is how far it
is from grey. Almost every colour problem that gets described as a hue problem
is a value problem wearing a hue's clothes: a crimson headline on a burnt
orange field disappears from across a room, not because the hues clash but
because the two values are the same. A design that fails in greyscale fails in
colour. The eye reads value first, hue second, and saturation last.

Harmony schemes are shorthand for relationships that hold together. Monochrome
is one hue at several values and saturations — quiet, unified, and prone to
looking flat unless the value range is wide. Analogous is two or three
neighbouring hues, which reads as natural because that is how light falls on a
single material. Complementary is opposite hues, and it is the loudest pairing
available; used at full saturation across large areas it vibrates, which is why
the classical use is a large muted field with a small saturated accent. Split
complementary softens that by taking the two neighbours of the opposite rather
than the opposite itself. Triadic is three hues evenly spaced — vivid, hard to
balance, and usually rescued by letting one dominate.

The 60-30-10 split is the practical form of "let one dominate": roughly sixty
per cent of the area in a dominant colour, thirty in a secondary, ten in an
accent. The numbers are not sacred and the principle is: colour that is evenly
divided has no hierarchy, and a viewer looking at a piece with no dominant
colour has nowhere to start.

Temperature is a relative judgement, not an absolute one. A red is warm beside
a blue and cool beside an orange. Warm colours advance and cool colours recede,
which is a real spatial effect and not a metaphor — a warm foreground against a
cool background reads as depth even in a flat composition. Neutrals are almost
never neutral: a grey mixed toward blue and a grey mixed toward ochre sit
differently against the same photograph, and a "white" background with a faint
warm cast will make a cool-lit photograph look wrong in a way that is hard to
name.

A limited palette buys coherence. Three or four colours, chosen and then held
to, make a set of pieces look like one thing; it also makes every decision
faster, because the question stops being "what colour" and becomes "which of
these". The discipline is in what gets excluded. Palettes usually fail by
accretion — a colour added for one element, then another for a second, until
nothing is dominant and nothing is an accent.

Colour carries mood, and the associations are cultural more than they are
inherent. High saturation and high contrast read as energetic, commercial,
young. Desaturated colours at close values read as calm, expensive, editorial.
Dark grounds read as formal or dramatic; cream and off-white read as warm and
traditional where pure white reads as clinical or modern. Muted earth tones
read as natural and hand-made. These are conventions, and conventions are
exactly what a viewer uses to place a piece in a moment before reading a word
of it.

Colour taken from a photograph is the most reliable palette there is. Pulling
two or three colours out of the image a piece is built around — a shadow value,
a mid-tone from the subject, one saturated note — guarantees the surrounding
design belongs to the picture rather than being applied to it. Sampling from
the shadows and the highlights rather than the obvious mid-tones tends to give
a more usable range.

Contrast for legibility is a value question with a measurable answer. Body text
wants a large value separation from its ground; small or light-weight type
wants more than large or bold type does. Coloured text on a coloured ground
needs more separation than the same pair would suggest as blocks of colour,
because letterforms are thin shapes and thin shapes lose their colour to the
ground around them. Placing type over a photograph is the common failure: the
photograph's value varies across the frame, so type that is legible over the
sky is invisible over the treeline, and the fixes are a scrim, a deliberate
flat area, or moving the type.

Saturation is the fastest way to make something look cheap and the fastest way
to make it look expensive. Full-saturation colour across a large area is
overwhelming to look at and hard to print; the same hue pulled back toward grey
reads as considered. Conversely, a composition of entirely desaturated colour
with no saturated note anywhere often reads as tired rather than as restrained.
One clean, saturated accent in an otherwise muted piece is a very old and very
reliable move.`,
};

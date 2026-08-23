import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Type and image — a foundation (compositor-v2.md §V.2).
export const typeAndImage: Skill = {
  name: "type-and-image",
  kind: "foundation",
  title: "Type and Image",
  summary:
    "Words and pictures in one frame: type over a photograph, captions and overlays, and where a title can sit at all.",
  text: `Putting type on a picture is a different problem from setting type on a page,
because the ground is no longer uniform. It varies in value, in colour and in
detail across the frame, and legibility, hierarchy and composition all have to be
solved against a background that was not designed for words.

The first question is whether the image can hold type at all. Photographs that
can are the ones with a genuinely quiet region: an area of sky, a wall, water,
shallow-focus background, shadow. Photographs that cannot are busy edge to edge,
or have their quiet region exactly where the subject needs breathing space.
Recognising this before placing anything is what separates a design from a
rescue, and the correct answer is often to place the type beside the picture
rather than on it.

Contrast is measurable, not a matter of taste. Light text needs a dark ground and
the reverse, with a comfortable ratio around 4.5 to 1 for anything at reading
size. Because a photograph's value varies across the frame, the check has to be
made at the lightest point under light text and the darkest point under dark
text — the word that falls across a highlight is the one that disappears.

When the image will not supply contrast, there are four honest devices. A
gradient scrim, dark at one edge fading into the picture, is the least intrusive
and works because photographs usually have a quiet edge. A solid panel behind the
words is blunt, reliable and reads as a label. A blurred region behind the type
keeps colour and light while removing detail. A shadow or glow on the letters
themselves is the last resort and looks it — a soft, generous shadow at low
opacity is far better than a hard one. What all four have in common is that they
should look like a decision: a half-hearted scrim is worse than none.

Weight and size interact with the ground. Heavy type survives a busy background
far better than light type; a thin elegant face over a detailed photograph will
be lost no matter what contrast the numbers say, because the letterforms are
being broken up by the detail behind them. Large type over an image can be set
tighter than body copy, and reversed-out text usually wants a fraction more
weight and letter spacing than the same words in black on white, since light on
dark visually thickens and closes up.

Composition is the second half. Type has to be placed with respect to the
picture's own structure: aligned to an edge or a horizon rather than floating,
placed in the direction a subject is looking or moving, and kept clear of a face.
The eye enters an image at the subject, so type placed on the opposite side of
the frame will be found second, which is usually correct for a caption and wrong
for a title.

Type can also be part of the image rather than on top of it. Letters cropped by
the frame, words that pass behind a subject, or type that follows the perspective
of a surface all read as integrated. These are strong effects and they cost
legibility, so they suit a title of three words and not a paragraph.

Captions are a separate register: small, close to the picture they describe,
consistently placed, and set in something that does not compete with the display
type. They are read more often than body text and should not be treated as a
technicality.

The failure modes: type placed over a face, a scrim so weak it only greys the
photograph, thin light type over detail, a title fighting the image's own focal
point, text that survives on one photograph and not on the next in the same
layout, and words centred on a frame whose subject is not.`,
};

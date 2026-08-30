import "server-only";
import type { Skill } from "@/server/skills/skill";

export const characterArtist: Skill = {
  name: "character-artist",
  kind: "occupation",
  title: "Character Artist",
  summary:
    "Designing people and creatures: shape language, silhouette, costume as biography, turnarounds and expression sheets.",
  text: `A character design is a piece of writing done with shapes. It has to say who
somebody is before they move or speak, and it has to keep saying it from every
angle, at every size, drawn by other people.

Silhouette is the first test and it is unforgiving. Filled solid black, a good
design is identifiable and distinct from every other design in the same
production. That is why strong characters tend to have one memorable
protrusion or proportion — a shape at the shoulders, a hat, a stance — rather
than detail spread evenly over the whole figure. In a cast, silhouettes are
designed against each other: a group where three figures share an outline is a
group an audience will confuse.

Shape language carries reading before anything representational does. Circles
read as friendly, soft and safe; squares as stable, reliable, heavy; triangles as
sharp, fast, dangerous. Building a figure from a dominant shape and repeating it
through the costume and props gives a design coherence, and inverting the
expected shape is a deliberate tool — a rounded villain reads very differently
from an angular one.

Proportion sets age, register and genre. Head counts are the shorthand:
naturalistic adults run around seven to eight heads tall, heroic figures eight or
nine, stylised characters four or five, and infantile designs two or three, which
is also why very short proportions read as young and appealing regardless of what
the character is. Exaggeration works when it is consistently applied; a
realistically proportioned head on a stylised body reads as a mistake.

Costume is biography. What somebody wears says their class, climate, work, era,
self-image and how much care they take, and wear patterns say more than cut does:
what is patched, what is new, what has been adjusted to fit. The best details are
functional — a tool worn where it can be reached, a fastening that matches the
technology of the world — and the weakest are ornaments applied because the
design needed something.

Colour on a character is hierarchy, not decoration. A dominant, a secondary and a
small accent placed where attention should go — usually the face or the hands —
is the pattern that survives. Value matters more than hue: a design should hold
together in greyscale, and against the backgrounds it will actually stand in,
because a character that disappears into a set is a design failure regardless of
how good it looks on white.

The production deliverables are what make a design usable by other people. A
turnaround gives front, three-quarter, side and back views on consistent height
lines. An expression sheet shows the face across the range it needs, which is
where a design's flexibility is proved — a face that only works neutral is not
finished. A pose sheet shows the character being itself rather than standing to
attention, and callouts detail props, fastenings and anything ambiguous.

Simplicity is a production constraint, not a style preference. Every extra buckle
is drawn hundreds of times, modelled, rigged and painted, and complexity that
does not survive being scaled down is complexity nobody will ever see. The
discipline is to spend detail where the eye goes and to leave large areas quiet.

The failure modes: a cast with interchangeable silhouettes, detail distributed
evenly, costume that says nothing about the world, colours that only work on a
white background, and a design that has never been drawn from the back.`,
};

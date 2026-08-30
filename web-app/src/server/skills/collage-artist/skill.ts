import "server-only";
import type { Skill } from "@/server/skills/skill";

export const collageArtist: Skill = {
  name: "collage-artist",
  kind: "occupation",
  title: "Collage Artist",
  summary:
    "Making one image from many: juxtaposition, cut edges, scale play, layering and ground, and when a set becomes a composition.",
  text: `Collage assembles a picture out of pieces that were made for something else. The
material arrives already finished — a photograph, a printed page, a scrap of
paper — and the work is entirely in selection, cutting and placement. Nothing has
to be drawn, which is why the discipline is so unforgiving about composition:
there is nowhere for technique to hide.

Juxtaposition is the medium's engine. Two images placed together produce a third
meaning that neither had alone, and the strength of that meaning depends on the
distance between them. Too similar and the pair is redundant; too far apart and
it is arbitrary. The productive gap is where a relationship is legible but not
obvious, and finding it is editing rather than making.

Scale play is the second tool and the most immediately powerful. Enlarging a
small thing and shrinking a large one breaks the reality of both, and consistent
scale relationships across a piece are what make it read as a coherent world
rather than a heap. A deliberate scale hierarchy — one dominant element, a
handful of medium ones, a scatter of small — is what turns a set of pieces into
a composition.

The cut edge is the mark. A hard, clean edge asserts that the piece is a
fragment; a torn edge shows the paper's own body and reads as raw and material; a
silhouette cut around a subject removes it from its origin entirely, while
leaving the original rectangle keeps the fact of the source visible. Mixing edge
treatments without reason is the most common way a collage looks unresolved, and
choosing one edge language and holding it is the fastest way to make one look
intentional.

Ground is the decision people forget. The background is not the leftover space:
white ground isolates and formalises, a coloured field unifies pieces that
otherwise clash, a textured or printed ground puts every fragment into one
material world. Negative space is what lets individual elements be seen at all,
and the difference between a dense collage that works and one that suffocates is
almost always whether the ground was designed.

Layering builds depth without perspective. Overlap says what is in front, a small
shadow or a lifted corner makes it physical, and the order of the stack is a
reading order. Depth can also be built by value alone — pieces of similar
lightness recede together, high-contrast pieces come forward — which is why a
collage is worth checking in greyscale.

Unity across borrowed material is the hardest problem, because every source has
its own light, palette, grain and era. The usual solutions are to limit the
palette by selection, to accept a single dominant colour cast, to introduce a
repeated element that appears in several places, or to give everything a shared
treatment — a common grain, a tint, a printing texture — that reads as one hand.

Repetition, rhythm and alignment do the structural work. A grid of similar
elements with one break is a strong composition; a rough alignment of edges gives
order without stiffness; and an intentional diagonal or a curve of elements will
lead the eye where an even scatter cannot.

Sourcing is part of the practice. Material is collected long before it is used,
and the archive shapes what can be made — which is why collagists sort by
palette, texture and subject rather than by origin.

The failure modes: elements floating with no relationship to the edges, uniform
scale throughout, an undesigned background, too many edge languages, sources so
mismatched in light that nothing coheres, and density with no space left to see
any single piece.`,
};

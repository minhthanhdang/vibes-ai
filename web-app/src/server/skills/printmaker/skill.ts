import "server-only";
import type { Skill } from "@/server/skills/skill";

export const printmaker: Skill = {
  name: "printmaker",
  kind: "occupation",
  title: "Printmaker",
  summary:
    "Ink on paper by process: separations and registration, limited colours, overprint, and the look each method gives.",
  text: `Printmaking designs for a process that puts ink on paper, and the process is
never neutral. Each method has a limited alphabet — how many colours, how fine a
line, how flat an area, how exactly two layers can be aligned — and designing
inside that alphabet rather than against it is the whole craft.

Everything begins with separation. The image is split into layers, one per ink,
and each layer is printed in its own pass. That fact drives the aesthetics of the
medium: colours are chosen and mixed as inks rather than blended optically, the
number of them is a budget, and the order they print in changes the result,
because most inks are semi-opaque and later layers sit on earlier ones.

Overprint is the medium's gift. Two transparent inks crossing make a third colour
for free, so a three-colour print can show six or seven, and designing the
overlaps deliberately is how a limited palette stays rich. It also means every
colour has to be considered in combination, not in isolation.

Registration is the alignment of those passes and it is never perfect. Designs
that need hairline accuracy between two layers will show the drift; the classical
answers are trapping, where one layer is slightly enlarged so a gap cannot open,
knocking out a shape from the layer beneath where an opaque overlay is wanted,
and simply designing with a little slop — deliberate offset, as in the misaligned
look, turns the constraint into the style.

Screen printing pushes ink through a stencil on a mesh: strong flat opaque
colour, capable of printing light on dark, with a limit on fine detail set by the
mesh and by how much ink is laid down. Halftone is possible but coarse. It is the
method of posters and garments.

Riso duplication is a stencil process with vivid, sometimes fluorescent, spot
inks, one drum per colour, cheap in quantity and famously imprecise: registration
drifts, ink smudges, coverage is uneven, and the accidental texture is why it is
chosen. Solid heavy areas are its weak point.

Letterpress prints from raised type or plates and gives a physical impression in
the paper. It suits type and line, works best on soft thick stock, and cannot
hold photographic tone well; large solids print unevenly.

Etching, engraving and other intaglio methods hold ink in incised lines below the
surface, giving fine detail, deep blacks and a plate mark. Lithography prints
from a flat surface using the repulsion of grease and water, and is the one
traditional method that reproduces drawn tone faithfully.

Paper is half the result. Weight, colour, sizing and surface change how ink sits:
uncoated stock absorbs and spreads — dot gain, which makes tones darker and
detail softer — while coated stock holds ink on the surface. Deckle edges,
handmade sheets and tinted stock become part of the image, and the colour of the
paper is effectively an extra ink, since almost every process leaves it showing
somewhere.

Designing for the process means thinking in flats and edges rather than in
gradients: strong shapes, deliberate texture, hand-made halftones or hatching for
tone, and type set heavy enough to survive ink spread. Reversed-out fine type is
the standard casualty.

Editions and the physical facts round it off: prints are numbered, artist's
proofs are kept aside, and each pull differs slightly, which is the point of the
medium rather than a defect.

The failure modes: a design needing perfect registration, too many inks for the
budget, fine reversed type, photographic gradients in a flat-colour process, and
colours chosen on a backlit screen instead of from ink swatches on the actual
paper.`,
};

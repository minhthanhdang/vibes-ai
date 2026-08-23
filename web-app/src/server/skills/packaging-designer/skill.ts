import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Packaging designer — an occupation (compositor-v2.md §V.2).
export const packagingDesigner: Skill = {
  name: "packaging-designer",
  kind: "occupation",
  title: "Packaging Designer",
  summary:
    "Dielines and faces, shelf presence at two metres, mandatory small print, and material as half the design.",
  text: `Packaging is design for an object that will be seen at two metres, picked up at
thirty centimetres, carried home and then lived with. It is the only graphic
discipline where the artefact has a back, a shelf life and a legal minimum
content, and all three shape the design more than taste does.

The dieline is the drawing everything is built on: the flat shape that is cut,
creased and folded into the pack, with fold lines, glue flaps, tuck tabs and
bleed marked. Reading one is knowing where the panels end up — which face is
front, which is back, which disappears under a fold or behind a seam, and where
the artwork must not carry anything important because a fold will land on it.
Bleed is not optional on a folded pack and neither is keeping type well inside the
crease, because cutting and folding both drift.

Shelf presence is decided at a distance, in a crowd, in bad light. The reliable
tools are a large area of a single colour, one dominant element, and a strong
silhouette from the structure itself. A pack is designed as a block of colour
first and read in detail second; the way to test it is to look at a mock-up
reduced small, or beside its actual competitors, rather than at full size on a
screen.

The hierarchy of the front face is short and it is worth being ruthless about:
what the product is, whose it is, which variant it is, and one reason to pick it
up. Variant navigation — flavour, strength, size — is the thing shoppers actually
struggle with, and it works when it is colour-coded and consistent across the
range, so a family reads as a family and a difference reads as a difference.

The back is a functional document: ingredients, nutrition or contents, weight,
barcode, batch and date coding, origin, disposal and recycling marks, warnings,
contact details. Much of this has a legally required minimum type size and
position; the barcode needs quiet space around it and enough contrast to scan,
which rules out reversing it out of dark colours or printing it on foil without
a white patch. Small print is a design problem to be solved, not a nuisance to be
crammed in.

Material and finish are half the perceived value. Uncoated board reads as
honest and natural, gloss lamination as clean and industrial, soft-touch as
premium, foil and emboss as luxury or as celebration. Print method matters too:
flexographic printing on corrugated cannot hold fine detail, and a colour has to
be specified as a spot ink if it must be identical across substrates. A design
approved on a screen has not been approved; it has to be seen on the actual stock
under the light the shelf uses.

Structure is design. The shape of the pack, how it opens, whether it can be
resealed, whether it stands on a shelf without falling over, how it stacks and
how much air is shipped are all decisions with brand and cost consequences.
Unboxing — the order in which things are revealed — is now part of the brief for
anything sold online, where the pack also has to survive shipping without its own
outer box.

Sustainability constraints are real: fewer materials, mono-material where
possible, avoiding laminations that cannot be separated, and not printing claims
that the pack itself does not support.

The failure modes: artwork designed on the flat and never folded, type across a
crease, a range where every variant looks like a different product, a barcode
that will not scan, mandatory copy set below the legal size, and a colour chosen
on a backlit screen for something printed on brown board.`,
};

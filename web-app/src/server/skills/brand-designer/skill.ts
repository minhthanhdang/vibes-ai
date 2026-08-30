import "server-only";
import type { Skill } from "@/server/skills/skill";

export const brandDesigner: Skill = {
  name: "brand-designer",
  kind: "occupation",
  title: "Brand Designer",
  summary:
    "Identity as a system: palette, type stack, layout rules, photographic direction and tone, held together across many pieces.",
  text: `A brand is not a logo. It is the set of decisions that make a poster, an
invoice, a shopfront and a job advert recognisably from the same place, and most
of those decisions have nothing to do with the mark. The mark is the smallest
element of the system and usually the least load-bearing: recognition in practice
comes from colour, type, photographic treatment, layout habit and tone of voice,
in roughly that order of speed.

A system exists to be applied by people who were not in the room. That is its
design constraint. Every rule has to survive being followed literally by somebody
in a hurry, which means rules are written as relationships rather than as
one-off compositions: type sizes as a scale rather than a list of pixel values,
margins as a proportion of the format rather than a measurement, colour roles as
jobs rather than favourites.

The palette is defined by role, not by preference. A primary that carries
recognition, a secondary or two that give the system somewhere to go, one or two
accents used sparingly enough to still mean something, and a full neutral
range — because most of any real artefact is neutral, and identities that specify
five brand colours and no greys end up improvised in every application.
Proportion matters as much as the hues: the same five colours at 70/20/10 and at
equal shares are two different brands.

The type stack is usually two faces and rarely more than three: one for
headlines that carries character, one for text that disappears, and a functional
face for interfaces, tables and small print. What makes it a system is the scale
and the rules for using it — which weight is a headline, what a subhead is
allowed to be, where the ragged edges go — not the names of the faces.

Photographic direction is the most under-specified part of most identities and
the most visible when it goes. Subject, treatment, light, colour cast, crop
habits, whether people look at the lens: written down, these make a set of
photographs by different photographers look commissioned rather than collected.
Illustration, if the system uses it, needs the same treatment and needs a stated
boundary with photography so that the two are not fighting for the same job.

Layout rules are what carry recognition when nothing else is present. A
consistent grid, a habit about where the mark sits, a signature use of a rule
line or a corner or a full-bleed colour field: these are cheap, they survive
reproduction, and they are what makes a piece identifiable at a distance where
neither the mark nor the type can be read.

Consistency is not uniformity. A system that produces identical artefacts is a
system that cannot handle a new format, and the ones that last define a centre
and a permitted range — flexible identity, in the trade's phrase — so that a
festival poster and a legal notice can both be correct. The rule of thumb is
that the constants are colour, type and voice, and the variables are layout,
imagery and scale.

The deliverable is a guideline, and the useful ones are short, are full of
examples of the thing done rather than described, show at least as many wrong
applications as right ones, and specify assets and formats precisely enough that
nobody has to redraw anything. The failure modes are: rules with no reasons,
which get ignored the first time they are inconvenient; a system tested only on
the flagship artefact, which then breaks on the small ugly necessary ones; and a
guideline delivered as a document nobody who applies it has ever opened.`,
};

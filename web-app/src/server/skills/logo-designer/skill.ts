import "server-only";
import type { Skill } from "@/server/skills/skill";

export const logoDesigner: Skill = {
  name: "logo-designer",
  kind: "occupation",
  title: "Logo Designer",
  summary:
    "Marks and wordmarks: the reduction test, counters and spacing, lockups and clear space, and drawn letters against set ones.",
  text: `A logo is not a picture of a company, it is a signature for one. Its job is
recognition at speed and in bad conditions, which means almost every decision in
it is a decision about what survives loss — loss of size, of colour, of
resolution, of attention.

The reduction test is the trade's one non-negotiable. A mark is judged at one
colour, at the size of a favicon or an embroidered chest badge, and at a glance
from across a room. Anything that dies under those three is not a logo yet: fine
line weight closes up, gradients band or go flat, small counters — the enclosed
white of an a, an e, a g — fill in and turn a word into a smudge. Working small
first and scaling up is the reliable order; a mark drawn large and then reduced
usually has to be redrawn.

Silhouette is what recognition actually runs on. Filled in solid black, a strong
mark stays distinguishable from every other mark in its category. That is the
test for distinctiveness too: the field of competitors, all blacked out, shows
immediately whether a shape is a claim or a coincidence.

There are four broad forms and they solve different problems. A wordmark is the
name drawn — it teaches the name, which is what a young company usually needs. A
lettermark or monogram is initials, useful when the full name is too long to be
read at signage size. A pictorial mark is a recognisable object; an abstract mark
is a shape that means nothing until it is taught, which costs advertising money
but can never be mistaken for anything else. A combination mark is a symbol and
a wordmark used together and separately, and it is the common answer because it
lets the symbol earn independence over years.

Drawing letters is not setting them. A wordmark begins from a typeface and then
stops being one: spacing is redrawn by eye, awkward pairs are cut in, the
crossbar of an A may drop, a leg may be shortened so a neighbour can nest.
Letterfit at logo scale is optical, not metric — the space inside letters and
the space between them have to look equal, which mathematically they are not.
Tightening a whole word uniformly is the usual amateur move and it closes the
counters first.

Clear space and minimum size are what stop the mark being ruined by everyone who
uses it afterwards. Clear space is expressed in a unit taken from the mark
itself — the height of the symbol, the x-height of the wordmark — so that it
scales with the thing it protects rather than being a number in millimetres that
means nothing at another size. Minimum size is stated separately for screen and
for print, because print can hold detail that a 24-pixel-tall rendering cannot.

A lockup is a fixed relationship: symbol and wordmark, or wordmark and
descriptor, in a proportion and alignment that does not get re-improvised. Most
identities need at least a horizontal lockup and a stacked one, because a wide
mark dies in a square slot and a stacked mark dies in a narrow banner. Anything
beyond those two is a decision to be made once and written down, not left to
whoever is making the next artefact.

Colour comes last and the mark must work without it. The primary version is
one-colour; colour is applied to a form that already reads. That order is also
what makes the reversed version — knocked out of a dark ground — work, and a
mark that only holds together in its brand colours is a mark that will break in
every fax, engraving, embossing and single-ink print it ever meets.

The failure modes are consistent: too many ideas in one shape, a visual pun that
has to be explained, detail that only exists on a screen at 400 percent, a
gradient doing the work a form should be doing, and trend-borrowing — the swoosh
era, the rounded-geometric-sans era — which dates a mark to the year it was
made rather than to the company it belongs to.`,
};

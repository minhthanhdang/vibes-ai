import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Composition — a foundation (compositor-v2.md §V.2).
export const composition: Skill = {
  name: "composition",
  kind: "foundation",
  title: "Composition",
  summary:
    "The frame's geometry — thirds, leading lines, balance, tension, negative space and where the eye enters.",
  text: `Composition is the arrangement of things inside a frame, and the frame is
half of it. A square, a wide rectangle and a tall rectangle are three different
problems: the same photograph and the same three words balance differently in
each, and a layout designed in one and then poured into another almost never
survives. The frame's proportion sets what feels stable — a wide frame invites
horizontal movement and a tall one invites vertical stacking — so the shape is
worth deciding before anything is placed in it.

The rule of thirds is a starting position, not a law. Dividing the frame in
three horizontally and vertically and placing the subject on a line or an
intersection puts it off centre, and off centre is dynamic where centre is
still. It works because it leaves unequal space around the subject, and unequal
space is what the eye reads as movement. Dead centre is not a mistake — it is a
strong, formal, symmetrical choice — but it should be a choice, because a
subject that landed in the middle by default reads as an accident.

Leading lines are anything the eye can follow: a road, a shadow's edge, a
railing, a column of type, a row of repeated shapes. They deliver the eye to
the subject, so their destination matters more than their elegance. A line that
leads out of the frame takes the viewer with it. Diagonals carry more energy
than horizontals or verticals because nothing in a rectangular frame is
parallel to them, and a composition built on one diagonal with a second
crossing it will always feel more active than a grid of squares.

Balance is about visual weight rather than area. A small dark element balances a
much larger pale one; a face outweighs an object of the same size because faces
are looked at first; high saturation outweighs low; detail outweighs flatness.
Symmetrical balance — matched weight either side of an axis — reads as formal,
calm, ceremonial. Asymmetrical balance, one large quiet mass answered by a
small loud one, reads as modern and is usually more interesting. Imbalance is
also available deliberately: weight stacked to one side creates unease, which
is useful when unease is the point and a defect when it is not.

Negative space is a positive material. The empty area around a subject is what
gives it a size to be read against, and enlarging it does more for a small
subject's presence than enlarging the subject does. Crowded compositions read
as cheap and urgent; generous ones read as confident and expensive, which is
why luxury work is mostly empty. The shapes that negative space makes should be
looked at directly — awkward slivers between elements, or a trapped gap that is
neither a margin nor a break, are the usual signs that something is misplaced.
Space at the edges is a margin; space between elements is separation; the two
are not interchangeable and equal amounts of both will make a layout read as
undesigned.

Tension is what happens near an edge. An element pushed close to the frame's
boundary, or two elements nearly but not quite touching, generates a pull that
the same element in open space does not have. Nearly-touching is the sharpest
version and the most fragile — a two-pixel overlap reads as an error where a
clear gap or a frank overlap both read as intended. The same applies to
alignment: almost-aligned is worse than either aligned or plainly offset,
because the viewer's eye is far better at detecting a small difference than at
naming it.

The eye enters a composition somewhere and leaves it somewhere. In cultures
that read left to right the entry is usually the upper left and the exit the
lower right, which is why a subject facing or moving toward the right feels
like it is going somewhere and the same subject facing left feels like it is
resisting. Leaving space in front of a moving or facing subject — more room
ahead than behind — is the oldest version of this and it still works.

Repetition and rhythm hold a composition together. Three of anything at
irregular intervals reads as a pattern with a rhythm; three at identical
intervals reads as a list. Odd numbers are harder to resolve into pairs and so
hold attention longer, which is the whole of the "groups of three" convention.
A break in an established rhythm — one element rotated, one out of line, one a
different colour — becomes the focal point automatically, and it only works
once per frame.

Scale contrast is the cheapest way to make a flat composition read. Elements of
similar size sitting together, however well arranged, give the eye no order to
proceed in. One thing much larger than everything else establishes a first
stop, and everything after it becomes second and third by comparison. When a
layout feels busy but empty, the usual cause is that everything on it is
roughly the same size.

Cropping is composition applied after the fact and it is not a rescue
operation. A crop decides what the subject is, how much air it has, and which
edges cut through the frame. Cutting a figure at a joint — wrist, ankle, neck —
reads as an amputation; cutting through the middle of a limb or a torso reads
as a frame. Cropping in tight buys intensity and loses context, and the choice
between them is the choice of what the image is about.`,
};

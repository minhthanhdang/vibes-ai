import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Production designer — an occupation (compositor-v2.md §V.2).
export const productionDesigner: Skill = {
  name: "production-designer",
  kind: "occupation",
  title: "Production Designer",
  summary:
    "The look of a filmed world: sets and locations, palette by sequence, set dressing as character, and building for a lens.",
  text: `Production design decides what a filmed world looks like and then builds enough
of it to be photographed. It covers sets, locations, dressing, props, colour and
often the way those change across a story, and its constraint is unlike any other
spatial discipline: only what the lens sees has to exist, and it has to exist by
a date.

The work starts from the script, broken down into what is needed: which scenes
are on location, which are built, which are dressed existing spaces, and what has
to be made because it does not exist. That breakdown is a budget document as much
as a creative one, and the design is shaped by it from the first day.

A built set is designed around the camera. Walls are made to be removed so a
crew can shoot from where the camera needs to be, ceilings are often omitted for
lighting, and a room is frequently built larger than a real one because
equipment, crew and a wide lens all need space that a real room does not have.
Height is exaggerated where lights hang. The plan is drawn with the lens in mind:
depth is built in — a doorway to another lit space, a window with something
beyond it — because a flat wall behind an actor is what makes an interior look
like a set.

Location work is the same problem in reverse. A real space is chosen for what it
gives and then edited: repainted, dressed, stripped of anachronism, given
practical lights that motivate the lighting design, and often modified so the
camera can move at all.

Set dressing is characterisation. What is on a shelf, how worn a doorframe is,
whether the pictures hang straight, what somebody has kept — these say who lives
there faster than dialogue does, and they are read even when they are barely in
focus. The discipline is specificity: real places accumulate, contain the wrong
objects, and are never coordinated. Absence is a tool too; a room with nothing
personal in it is a statement.

Palette is scripted across the film, sequence by sequence, so that a change in
the story has a visual counterpart. Sets and costumes are agreed against the same
palette, because a wall colour and a coat that were chosen separately will fight
in every frame. Value matters as much as hue: a dark set needs bright accents for
the frame to have structure, and a very light one leaves nowhere for a face to
stand out.

Texture and age are what make a built world convincing. New timber, fresh paint
and unmarked surfaces photograph as false, so almost everything is treated:
stained, distressed, dirtied down, given the wear that use produces. What the
camera reads is contrast and irregularity, and a scenic painter's job is largely
to supply it.

Practical constraints run through everything: what can be built in the time,
what can be safely rigged, what a crew can strike overnight, whether a wall can
be flown out, whether a prop has to work on camera and therefore has to work.
Continuity of the physical world across a shooting schedule that films scenes out
of order is a full-time job in itself.

The failure modes: sets designed as architecture rather than for a lens, walls
that cannot move, rooms with no depth behind the actors, dressing that looks
shopped rather than accumulated, everything the same age, and a palette agreed
with the camera department but not with costume.`,
};

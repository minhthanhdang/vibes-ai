import "server-only";
import type { Skill } from "@/server/skills/skill";

export const architect: Skill = {
  name: "architect",
  kind: "occupation",
  title: "Architect",
  summary:
    "Buildings and space: plan, section and elevation, circulation, daylight and structure, and drawing as the medium.",
  text: `Architecture designs space that people move through over time, which makes it the
discipline where composition is experienced sequentially and at full size. The
work is done in drawings and models that stand for something none of the people
deciding will see until it exists.

The drawing set is the language. A plan is a horizontal cut, usually about a
metre above the floor, and it is where organisation, circulation and structure
are decided. A section is a vertical cut and is the drawing where light, height
and the relationship between levels can be seen at all; a project understood only
in plan is a project whose spatial quality nobody has tested. An elevation shows
a face flat and is a poor description of experience but the right one for
proportion, rhythm and material. Axonometric and perspective views are for
explaining, not for designing.

Parti is the organising idea — the one diagram the building is: a bar with rooms
on one side, a courtyard, a stack around a core, a linear route with volumes hung
off it. A clear parti survives the hundreds of compromises that follow. Without
one, a plan becomes an assembly of rooms that happen to fit.

Circulation is the design's connective tissue and usually a quarter of the area.
The questions are how somebody arrives, what they see first, where the thresholds
are, and whether movement is pushed to the edges or allowed to run through
rooms. Sequence — compression then release, dark then light — is the primary
experiential tool, and it is composed exactly as pacing is composed in any
time-based medium.

Daylight is the material with the largest effect on how a space feels and it is
governed by orientation. North light is even and cool all day, south light is
strong and needs shading, east and west light is low, raking and hard to control.
Depth of a room from its window decides whether the back of it is usable; light
from two sides transforms a room; a high window washes a wall and a low one gives
a view. Section drawings are where this is worked out.

Structure and the grid are the discipline underneath the plan. Spans decide the
depth of beams and the spacing of columns, load has to reach the ground, and
services need vertical routes and horizontal space above ceilings. Working these
out early is what stops a design that has to be rebuilt once an engineer sees it.

Proportion and scale carry the architecture. The size of an opening relative to
a wall, the ratio of a room's height to its width, the module of a facade: these
are the composition. Human scale — a door, a step, a handrail, a sill — is the
reference by which everything else is read, and removing every human-scaled
element is how buildings become illegible in size.

Material is structural, tactile and temporal at once. Masonry, timber, concrete
and steel each have a natural span and a way of meeting the ground and the sky.
How a material weathers is part of the design: staining, patina, movement joints
and where water goes are decisions, and buildings that ignored them announce it
within five years.

Context is a constraint and an argument: the street line, neighbouring heights,
local material, the sun path, prevailing wind, views to keep and to hide, plus
regulation — fire escape distances, accessible routes, daylight rights,
planning limits — which shapes form far more than most drawings admit.

The failure modes: a plan designed without a section, circulation left over
rather than designed, rooms too deep for their windows, structure invented after
the fact, no human-scaled element anywhere, and detailing that never asked where
the water goes.`,
};

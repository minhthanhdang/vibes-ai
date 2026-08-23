import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Interior stylist — an occupation (compositor-v2.md §V.2).
export const interiorStylist: Skill = {
  name: "interior-stylist",
  kind: "occupation",
  title: "Interior Stylist",
  summary:
    "Rooms: materials and finishes together, layered light, staging and scale, and palettes that live with what is already there.",
  text: `Styling a room is composing with objects that have weight, cost and a use. The
constraints are unlike any flat medium: the composition is walked through rather
than looked at, it changes with the hour, and most of what is in it was chosen by
somebody else and is staying.

A scheme is built from a material palette rather than a colour palette — timber,
stone, metal, ceramic, glass, textile — because in a room colour arrives
attached to a finish. Three to five materials is a workable number, with one
dominant, one supporting and one used sparingly enough to register as an accent.
The pairings that matter are of warmth and of sheen: warm oak against cool
concrete, matt plaster against polished brass. A room where every surface has the
same reflectivity reads as flat no matter what the colours are.

Colour in a room follows a proportion more than a harmony — the common rule of
thumb is around sixty percent for the dominant, thirty for the secondary and ten
for the accent. Large fields of colour behave differently from swatches: a
saturated tone that is pleasant on a card is overwhelming across four walls, and
every colour is pushed by the light in the room and by what it sits next to.
Testing means putting a large sample on the actual wall and looking at it at
several hours.

Light is the single biggest variable and it is layered. Ambient light fills the
room, task light does work at a specific place, and accent light picks out one
thing. A room lit by one central fixture is the standard failure; the fix is
several sources at different heights, most of them low, on separate switches.
Colour temperature should be consistent within a space — mixing warm and cool
sources is visible and unpleasant — and daylight orientation decides which
palettes will work at all, since a north-facing room takes cool light all day and
will make a cold grey colder.

Scale and proportion are what separate a styled room from a furnished one.
Furniture too small for a room leaves it feeling like a waiting area; rugs are
the most commonly undersized element, and should sit under the front legs of the
seating at minimum. Height needs to be varied deliberately — a room where
everything stops at waist level has no vertical composition — and hanging art
too high is the most frequent single error, with centre at eye level being the
usual correction.

Arrangement starts from what the room is for: a seating group that people can
talk across, circulation routes that are not walked through the middle of the
conversation, and a focal point that is either given by the architecture or
created. Furniture pushed against every wall is the default arrangement and
rarely the best one.

Styling itself — the last layer — works in groups rather than in items. Odd
numbers, varied heights, one repeated material to tie a group together, and
negative space around the group so it reads as intentional. Texture is what makes
a photograph of a room look inhabited: linen, wool, ceramic, dried and living
plants, the visible wear of things that are used.

The failure modes: a scheme assembled from samples never seen in the room's own
light, everything at one height, one central light source, a rug too small,
a palette with no neutral to rest on, and styling so exact that nobody could sit
down in it.`,
};

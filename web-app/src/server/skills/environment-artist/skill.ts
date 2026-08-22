import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Environment artist — an occupation (compositor-v2.md §V.2).
export const environmentArtist: Skill = {
  name: "environment-artist",
  kind: "occupation",
  title: "Environment artist",
  summary:
    "Places: scale cues, atmospheric depth, staging a space so it reads, and the storytelling a location does on its own.",
  text: `An environment is a place rather than a picture of objects, and the difference
is that a place has size, depth, weather and history. Making one read means
answering three questions before anything is drawn: how big is it, how far does
it go back, and what happened here. A rendered space that answers none of them
looks like a set of shapes at an unknown distance, which is the default failure of
the form.

Scale is communicated only by comparison, never by size on the surface. The
reliable cues are human ones — a figure, a door, a stair tread, a handrail, a
window, a bench, a bollard — because their real dimensions are known and the eye
converts them instantly. A doorway is roughly two metres, a stair riser about
seventeen centimetres, a handrail a metre. Placing one such object in a scene sets
the scale of everything around it; placing none leaves the viewer guessing, and
placing two at contradictory sizes destroys the illusion outright. Enormous scale
is sold by repetition of a known unit — a wall of identical windows receding —
rather than by making one thing large, because a single large object has nothing
to be large against.

Depth is built in layers, and the conventional division into foreground,
midground and background is a working method rather than a description. The
foreground frames and is usually dark, large, out of focus and only partly in
frame — an overhanging branch, the edge of an arch, a shoulder of rock. The
midground carries the subject and the detail. The background establishes the
world and the light. Overlap between layers is the strongest depth cue there is:
one thing passing in front of another states their order unambiguously in a way
that size and position only imply.

Atmospheric perspective is the second major depth instrument and it is a physical
effect worth applying precisely. With distance, contrast falls, values converge
toward the sky's value, saturation drops, and hue shifts toward the colour of the
air — blue in clear daylight, warm in haze or dust, grey in fog, and toward the
light source's own colour near sunrise and sunset. The far distance is therefore
neither dark nor light in itself; it approaches the sky. A common error is to
apply the haze to value alone and leave distant objects fully saturated, which
reads as a flat grey wash over a poster rather than as air. Edges soften with
distance for the same reason, so the hardest edges in a scene belong in the
foreground.

Staging is the arrangement of the space so the eye is led into it and around it.
A path, a river, a road, a run of light, a line of poles or a wall gives the eye a
route from the near edge to the point of interest; a frame within the frame — an
arch, a gap between trees, a doorway — concentrates attention on what is beyond
it. The focal point should have the scene's highest contrast and its hardest
edges, and the surrounding areas should be quieter by design rather than by
accident. Negative space matters as much as it does anywhere else: a place with
no rest in it reads as clutter, and an empty region is what gives a silhouette
something to be seen against.

Light does the mood work and its direction is chosen before anything is placed.
Low raking light gives long shadows that describe the ground plane and reveal
every undulation on it; overhead light flattens a space and leaves it airless;
backlight fills the volume with visible atmosphere and turns everything between
into silhouettes, which is the cheapest and most reliable way to make a space
feel deep. Shafts, dapple and pools of light are also composition — an area of
light on the ground is a shape, and it can be placed as deliberately as any
object.

A place tells a story through its wear, its arrangement and its absences. Paths
worn where people actually walk, repairs made in a different material, things
left where somebody put them down, growth where nothing maintains it, and
lighting fittings that imply who wanted the space lit and why — these are what
distinguish a location from a stage. The rule of thumb is that everything in a
space was put there by someone or grew there, and asking which of the two for
each element is what makes a place credible.

The failure modes are consistent: no human-scale reference, so nothing has size;
uniform detail and contrast across the whole depth, so there are no layers; haze
applied as grey rather than as the sky's colour; a symmetrical or centred subject
with no route into the scene; clutter with no negative space to read it against;
and a floor plane left undescribed, since shadows, texture change and the
receding scale of ground detail are what put objects in a place rather than in
front of one.`,
};

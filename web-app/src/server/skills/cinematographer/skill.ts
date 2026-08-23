import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Cinematographer — an occupation (compositor-v2.md §V.2).
export const cinematographer: Skill = {
  name: "cinematographer",
  kind: "occupation",
  title: "Cinematographer",
  summary:
    "The camera as an author: lens and aspect ratio, lighting for motion, exposure and contrast, and a colour script that holds.",
  text: `Cinematography is photography with two additions: the frame moves, and the frames
have to belong to each other. Every choice is therefore made twice — once for the
shot and once for the sequence it lives in.

Aspect ratio is the first decision and it is close to irreversible. The academy
frame and its descendants hold a standing figure comfortably and make faces
monumental; wide formats hold two people in one frame with the space between them
as the subject, and punish vertical composition. The ratio decides how much of
the world is admitted at once, so it decides how much staging can be done inside
a shot instead of across a cut.

Lens choice is characterisation. A wide lens close to a face distorts and
implicates; a long lens compresses, isolates a subject from a background and
flattens depth. Consistency of focal length across a sequence is one of the
quieter ways a film holds together, and a change of lens family mid-scene reads
as a change of voice even when nobody can name it.

Depth of field is a pointing device. A shallow field says where to look and
throws everything else away, which is why it flatters and why it is overused;
deep focus keeps a whole space legible and lets action stage itself in depth.
Focus that moves — a rack from one subject to another — is a cut without a cut,
and it directs attention as strongly as one.

Exposure decides where the image sits, not just whether it is bright. Protecting
highlights matters more in digital capture, protecting shadows more in film; the
choice of where to put the face on the curve is what makes an image feel bright,
normal or nocturnal. Contrast ratio between key and fill is the practical
control: a small difference reads as gentle and commercial, a large one as
dramatic, and something close to no difference reads as documentary daylight.

Lighting for motion is different from lighting a still, because the subject
leaves the pool of light. A source is placed so that a move stays exposed, or the
move is choreographed to the light — walking into a shaft is a shot, walking out
of one is another. Motivation matters: light that appears to come from a window,
a lamp or a fire is accepted, light with no source in the world is noticed.

Camera movement has grammar. A push in intensifies, a pull out reveals or
abandons, a pan follows and connects, a track holds a relationship with a moving
subject, and a handheld frame introduces a body into the image. Movement without
a reason is the most common excess in the craft; the reliable rule is that a move
should begin and end on a composition that would stand on its own.

Colour is scripted across a film, not chosen per scene. A colour script assigns
palettes to sequences so that a shift in the story has a visual counterpart, and
it is what stops a film looking like a collection of well-photographed rooms.
The grade finishes it: matching shots to each other first, then shaping contrast
and colour to intent. A grade cannot rescue an image that was not exposed for it,
and it can easily destroy skin tones, which are the reference every audience
reads without knowing they are reading it.

The failure modes: an aspect ratio chosen after the shoot, lens families mixed
without reason, shallow focus used everywhere until nothing is emphasised,
lighting that dies the moment an actor moves, movement with no motivation, and
a grade so strong that faces stop looking like people.`,
};

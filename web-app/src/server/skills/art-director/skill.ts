import "server-only";
import type { Skill } from "@/server/skills/skill";

export const artDirector: Skill = {
  name: "art-director",
  kind: "occupation",
  title: "Art Director",
  summary:
    "The idea across a campaign: casting and treatment, what the pictures are of, and holding one look over many hands.",
  text: `Art direction is the job of deciding what the pictures are of and what they look
like, and then getting other people to make them that way. It sits above craft
and below strategy: the strategy says what the work must achieve, the crafts —
photography, illustration, type, retouching, set building — execute, and art
direction is the connective decision-making that makes the result feel like one
thing.

The first output is a reference set: images pulled from elsewhere that define
light, palette, casting, styling, framing and mood before a single frame is
commissioned. The reference is a contract, not inspiration. Its purpose is to
make sure that what the director sees in their head and what a photographer,
stylist and client each see are close enough to survive a shoot day. Good
reference is specific about treatment and vague about content — an image chosen
for its light with a note saying so, rather than an image that will be copied.

Casting is the largest single lever on how a picture feels and the one most
often left too late. Faces, bodies, hands, location, props, animals: each carries
associations before composition or colour do anything at all. A campaign is cast
long before it is lit.

Treatment is the vocabulary that has to be settled: hard sun or overcast, flash
or ambient, film grain or clean digital, saturated or desaturated, shot on wide
lenses in a space or long lenses in isolation, colour cast warm or cool. Those
choices repeated over twenty images are what a look is. Written down they are
also what allows a second photographer, a year later, to add to the set without
breaking it.

A campaign is a set, and a set has to work in two directions: each image must
stand alone, and the group must read as a family without being repetitive.
The usual construction is one hero that carries the idea, several supporting
images that extend it into other subjects or formats, and a few textures or
details that give layouts somewhere to breathe. Variety of scale across the set
matters more than variety of subject.

Formats are decided before the shoot, not after. A picture composed for a
horizontal billboard cannot be cropped to a vertical phone frame without losing
its subject or its space, so shoots are planned to deliver a frame per aspect
ratio, or composed with enough room around the subject that several crops exist
inside one negative. Where the type goes is part of the composition and has to be
protected on the day.

Direction on the day is triage: knowing which of the hundred variables actually
carry the idea, and letting the rest go. The director's job on set is to keep the
reference honest, to watch for the frame that is better than the plan, and to
call it when the plan is not working — which is a different skill from having
made the plan.

Reviewing work means being specific. Feedback that names what to change and why
is usable; feedback in adjectives is not. The reliable questions are whether the
image is doing the job it was cast for, whether it sits with the others,
and whether it survives the size and the place it will actually be seen.

The failure modes: a look assembled from references that were never reconciled
with each other, a set where every image is the same shot of a different thing, a
hero image that cannot be cropped to any of the required formats, and a
consistent treatment applied so rigidly that nothing in the set surprises.`,
};

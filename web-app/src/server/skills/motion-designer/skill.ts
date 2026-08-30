import "server-only";
import type { Skill } from "@/server/skills/skill";

export const motionDesigner: Skill = {
  name: "motion-designer",
  kind: "occupation",
  title: "Motion Designer",
  summary:
    "Graphics in time: timing and easing, the beat of a sequence, transitions that explain, and type that has to be read while moving.",
  text: `Motion design is graphic design with a fourth dimension, and the fourth dimension
has its own craft. A layout that is beautiful held still can be unreadable at
speed, and a sequence that plays well can be a series of ugly frames. Both have
to be true at once.

Timing is the primary material. Durations in the range of 150 to 300
milliseconds read as immediate and responsive; half a second is a deliberate
gesture; anything past a second is a scene rather than a transition. The
practical rule is that functional motion should be fast enough that nobody waits
for it and slow enough that nobody misses what changed. Larger objects need more
time than small ones to feel like they have mass.

Easing is what separates motion design from animation-by-default. Linear movement
reads as mechanical because nothing in the physical world starts and stops
instantly. Ease-out — fast at the start, settling at the end — suits things
arriving and is the safest general choice. Ease-in suits things leaving.
Ease-in-out suits a move between two resting states. Overshoot and settle add
character and quickly become a tic if used everywhere.

The classical animation principles still apply to abstract shapes: anticipation
before a move, follow-through and overlapping action so that parts of a group do
not all stop at the same instant, squash and stretch used sparingly for weight,
and arcs rather than straight paths, because straight-line movement is the second
tell of unconsidered animation after linear easing.

Staggering is the everyday tool. A list of items animating together is a wall; the
same items offset by 30 to 60 milliseconds each read as a sequence and guide the
eye through the order. The offsets should be small enough that the group still
feels like one action.

Continuity is what makes motion explanatory rather than decorative. If an element
opens from a card, it should grow out of that card and return to it; shared
elements that persist across a transition tell the viewer that this is the same
thing in a new place. Motion that has no relationship to what changed is noise,
and noise is expensive because it is seen on every repetition.

Type in motion has to be legible while moving, which means it usually should not
be. The reliable pattern is that type animates into place quickly and then holds
still for as long as it takes to read — roughly the time to read it aloud, plus a
beat. Type that is still moving while being read is type nobody read.

A sequence has a beat, and cutting to music is the most effective way to find it.
Aligning key moments to a rhythm, holding on the important frame, and giving the
viewer a rest between dense moments are the difference between a piece that plays
and a piece that is merely full. Every sequence needs a last frame that is worth
stopping on, because it is the frame that stays on screen.

Formats and technical constraints shape everything: frame rate consistency,
delivery in several aspect ratios, and the assumption that most viewers will
watch without sound, which means anything carried by audio must also be carried
visually. Accessibility matters here more than in static work: large moving
fields and parallax cause discomfort, and a reduced-motion alternative should be
part of the design rather than an afterthought.

The failure modes: everything eased the same way, animation used to hide a weak
layout, transitions longer than the attention they are asking for, type read over
a move, and a piece that looks impressive once and is unbearable the fifth time.`,
};

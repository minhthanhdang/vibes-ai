import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Animator — an occupation (compositor-v2.md §V.2).
export const animator: Skill = {
  name: "animator",
  kind: "occupation",
  title: "Animator",
  summary:
    "Movement itself: timing and spacing, keys and breakdowns, weight and arcs, and acting through pose rather than detail.",
  text: `Animation is the craft of making something look alive by controlling when it is
where. Everything else — design, rendering, effects — sits on top of two
quantities: timing, which is how many frames a movement takes, and spacing, which
is how far the subject travels between them. Timing gives an action its speed;
spacing gives it its weight and its texture.

Even spacing reads as mechanical. Real movement accelerates and decelerates, so
drawings bunch up where a movement slows and spread out where it is fast, which
is what the trade calls slowing in and slowing out. A heavy object accelerates
gently and takes many frames to stop; a light one snaps. Getting weight wrong is
almost always a spacing problem rather than a design problem.

The working structure is keys, breakdowns and inbetweens. Key poses are the
storytelling positions — the ones that would be drawn if only three drawings were
allowed — and they are timed first, usually as a pose test, before any smooth
motion exists. The breakdown between two keys is where the character is decided:
it can arc high or low, lead with a different part of the body, or overshoot, and
the same two keys with different breakdowns produce two entirely different
actions. Inbetweens are the last and least interesting part.

Arcs are the default path of anything organic. Joints rotate, so hands, heads and
feet travel on curves; tracking a moving part frame by frame and finding a
straight or a wobbling path is the standard diagnostic for a shot that feels
wrong.

Anticipation, follow-through and overlapping action are what make a movement read
as physical. A body gathers before it moves, trailing parts — hair, cloth, a
tail — arrive late and settle after the main mass has stopped, and different
parts of a figure stop at different times. Everything stopping on the same frame
is the tell of unconsidered animation, along with everything starting on the same
one.

Squash and stretch preserves volume while showing force and elasticity, and it is
scaled to the material: a rubber ball is extreme, a human face slight, a chrome
sphere none at all. Exaggeration is not distortion for its own sake but pushing
the clear reading of an action past the literal, because a literally accurate
movement usually reads as weak on screen.

Acting is done in poses, not in detail. A silhouette that reads, a line of
action running through the whole body, and a clear change of thought between
poses will carry a performance further than facial detail will. Moving holds —
where a character continues to breathe and settle while apparently still — keep a
figure alive between beats; a truly frozen figure looks dead unless the stillness
is the point.

Staging is the shot's own clarity: one idea at a time, presented so the important
action is unmistakable, with the camera and the composition supporting rather
than competing. Two important things happening at once means one of them is lost.

Frame rate and shooting on twos are practical choices with a look: many
traditionally animated films hold each drawing for two frames, which reads as
fluid enough and costs half the drawings, while fast action is animated on ones.
Mixing them within a shot is a deliberate texture, not an accident.

The failure modes: floaty movement from even spacing, everything starting and
stopping together, paths that are straight where they should curve, weight that
does not match the object's apparent mass, performances built from details rather
than poses, and a shot polished before its timing was ever tested.`,
};

import "server-only";
import type { Skill } from "@/server/skills/skill";

export const storyboardArtist: Skill = {
  name: "storyboard-artist",
  kind: "occupation",
  title: "Storyboard Artist",
  summary:
    "Shots in sequence: shot sizes, screen direction and continuity, what a panel must show, and boards against animatics.",
  text: `A storyboard is a plan for time. Every panel stands for a shot, and the board
exists to answer questions before they cost money: where the camera is, how long
the moment lasts, whether the cut works, and whether the space stays readable
from one shot to the next. Drawing quality is close to irrelevant; clarity of
staging is everything.

Shot size is the first vocabulary. Wide or establishing shows where the scene is
and how the figures relate to it. Full shot holds a figure head to foot. Medium
cuts at the waist and is the workhorse of dialogue. Close-up is a face, and it is
the only shot that reliably carries emotion. Extreme close-up isolates a detail
and stops the story to do it. The sizes are a budget: a close-up spent early has
nowhere to escalate to.

Angle and lens are the second. Eye level is neutral. Low angle gives a subject
weight, high angle takes it away, and a dutch tilt announces that something is
wrong. A long lens flattens and isolates; a wide lens exaggerates depth and can
be pushed close enough to distort. On a board these are drawn, not annotated:
a panel that needs a sentence to explain the angle has not shown it.

Screen direction is the rule that makes cutting legible. An imaginary line runs
through the action, and staying on one side of it keeps the geography stable — a
character looking right in one shot must look right in the next, or the two shots
read as facing away from each other. Crossing the line is allowed, but it has to
be earned with a cut on movement, a neutral shot, or a camera move that carries
the viewer across.

Continuity is the housekeeping that makes a sequence hold: eyelines that match,
a prop that stays in the same hand, light that comes from the same side, and
overlapping action across a cut so the movement reads as continuous. Most of
what a board catches is exactly this kind of error, which is far cheaper to find
in pencil than on a set.

A panel is a frame at the correct aspect ratio, and it shows one moment — the
moment that makes the shot legible, usually the end of a move rather than its
beginning. Camera movement is drawn with arrows for pans and pushes, and a
single panel with two boxes for a move that starts wide and ends tight. Figures
should read in silhouette; anything that will not be visible in the finished
frame does not belong in the panel.

Under each panel goes the minimum: shot size, any move, dialogue or sound cue,
and the intended duration. Duration is what makes a board a plan for time rather
than a comic — a sequence of ten panels that plays for eight seconds is a
different scene from the same ten across a minute.

Beat and pacing are decided at the board stage. A run of similar sizes reads as
flat; alternation gives rhythm; a held wide before a fast cut sequence makes the
fast part faster. Cutting rate is a tool with a meaning, and boards are where it
is tested.

An animatic is the board timed — panels edited to the intended durations with
scratch dialogue and sound — and it is the only way to know whether the cutting
works, because a board read at reading speed always plays faster in the head than
it does on screen. Boards for live action are diagrams for a crew and can be
loose; boards for animation are closer to a specification, because everything in
the finished shot has to be drawn by somebody who was not there.

The failure modes: panels drawn as pretty illustrations that hide the staging,
every shot at the same size, an action described in text rather than shown, and
a board that never leaves the storyboard artist's own head into a timed cut,
where the pacing problems all live.`,
};

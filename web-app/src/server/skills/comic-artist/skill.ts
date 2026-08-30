import "server-only";
import type { Skill } from "@/server/skills/skill";

export const comicArtist: Skill = {
  name: "comic-artist",
  kind: "occupation",
  title: "Comic Artist",
  summary:
    "Sequential storytelling: panel layout and gutters, page turns, balloon placement and reading order, and pacing on paper.",
  text: `A comic tells a story with pictures the reader controls the speed of. The page is
seen whole before it is read in sequence, which makes comics the only narrative
medium where composition and time are the same decision.

The panel is a unit of time as much as a unit of space. A wide panel reads as
slow, a narrow one as quick, a large one as important. Time between panels lives
in the gutter, and the reader supplies it: the jump from one panel to the next
can be a moment, an action, a scene change or a leap of years, and the drawing on
either side is what tells the reader which. Closure — the reader completing what
happens between panels — is the mechanism the whole medium runs on, and the most
common beginner error is drawing every intermediate moment so nothing is left for
it.

Layout controls reading order and must be unambiguous. In left-to-right
languages the eye moves in a Z: across the tier, then down. Panels of unequal
height in the same tier, or a gutter that lets the eye fall through vertically
when it should travel across, produce a page that is read in the wrong order,
and a reader who has to work out the order has left the story. Wider gutters
between tiers than between panels is the standard fix.

The page is a compositional whole. Two facing pages are seen together, so a
surprise on the right-hand page is visible before it is read; the page turn is
the medium's only reliable concealment, which is why cliffhangers, reveals and
punchlines are placed on the first panel after a turn. Chapter and issue lengths
are built around that rhythm.

A splash — one image filling a page — buys emphasis with space and can only be
spent a few times. A tight nine-panel grid produces relentless steady time; an
irregular layout produces drama and costs clarity. Bleeding a panel off the edge
of the page reads as space extending beyond the frame, and is a common way to
signal openness or overwhelm.

Lettering is part of the drawing, not applied to it. Balloons are placed in the
reading order the dialogue happens in, so the art has to be composed with room
for them — usually at the top of the panel — and speakers are staged left to
right in the order they talk. Tails point clearly to one speaker. A panel is
comfortable up to roughly 25 to 35 words; beyond that the art has become
wallpaper for text. Caption boxes carry narration and time transitions; sound
effects are drawn objects with their own weight and placement.

Storytelling clarity beats draughtsmanship every time. Each panel needs one
clear subject, a staging that keeps the geography of the scene consistent from
panel to panel, and the same left-right screen direction rules that film uses,
because breaking them flips the space and confuses the reader. Establishing
shots earn their place whenever the location changes.

Value and spotting blacks hold the page together. Large areas of solid black
placed deliberately give the page structure, guide the eye and stop a grey
uniform texture; ink weight can separate foreground from background where colour
is absent. In colour work, palette can be shifted per scene to mark time and
place, and it is one of the cheapest ways to make a long story navigable.

The failure modes: a layout whose reading order is ambiguous, no room left for
balloons, every panel the same size, a reveal on the wrong side of the page turn,
too much drawn between panels, and beautiful drawings that do not tell the
reader where anyone is standing.`,
};

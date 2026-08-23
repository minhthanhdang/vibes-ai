import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Exhibition designer — an occupation (compositor-v2.md §V.2).
export const exhibitionDesigner: Skill = {
  name: "exhibition-designer",
  kind: "occupation",
  title: "Exhibition Designer",
  summary:
    "Graphics in space: wayfinding and sightlines, viewing distance and type size, sequence through a room, and durable materials.",
  text: `Exhibition and environmental graphics put design into a space people walk
through. The medium is architecture as much as it is graphic design, and the
governing facts are the body: how far away somebody stands, how tall they are,
how they move through a room, and how long they will stay.

Viewing distance sets type size and it can be calculated rather than guessed. A
common rule of thumb is roughly 25 millimetres of cap height for every 8 to 10
metres of viewing distance for signage read at speed, with introductory panels
set larger than object labels because they are read from further back. Labels are
read at arm's length and can be small; a title wall is read from the doorway and
cannot.

Height is the other body measurement. The standard centre line for wall-mounted
work and text panels sits at roughly 1.4 to 1.5 metres, which is average eye
level, and consistency of that line across a room does more for coherence than
any decorative device. Anything below about 900 millimetres is out of comfortable
reading range, and anything above roughly two metres is for orientation rather
than reading.

Sequence is the design. A visitor enters somewhere, and the arrangement decides
what is seen first, what is seen against what, and where the route offers a
choice. Sightlines are drawn in plan and checked in section: the view from the
entrance, the view down the length of the room, and what is visible behind the
thing being looked at. Circulation has to accommodate groups stopping, and the
pinch points where people accumulate — the first object, the interactive, the
exit — need more space than the drawing suggests.

Pacing prevents fatigue. Dense text sections alternate with open ones, big
objects with small, bright rooms with dark, and there has to be somewhere to sit.
A typical visitor reads far fewer words than a curator expects, so text is
layered: a headline anybody will read, a short paragraph some will read, and
detail for the few who want it.

Wayfinding is its own discipline within the work: a consistent hierarchy of
identification, direction, orientation and regulation signage; decisions placed
where the decision is made rather than after it; and terminology that never
changes between a map, a sign and a door. A visitor should always be able to
answer where they are, where they can go and how they get out.

Light is both preservation and drama. Sensitive material has strict limits on
illuminance and exposure, which constrains the whole scheme; glare on glazed
cases, reflections that put a visitor's own face over an object, and a lit label
in a dark room are practical problems solved with angles rather than fixtures.

Materials must survive a public. Surfaces are touched, leaned on and cleaned;
vinyl lettering on painted wall, direct-printed panels, routed acrylic and
fabricated letters each have a lifespan, a cost and an installation tolerance.
Substrates are chosen for flatness and finish under raking light, and everything
is designed with the fixing method in mind, because the fixing is visible.

Accessibility is legislated and also simply right: step-free routes, reachable
heights, contrast between text and ground, tactile and large-print alternatives,
and audio or captioned equivalents for anything time-based.

The failure modes: type sized on a desktop rather than at distance, panels hung
at inconsistent heights, a route with no clear beginning, more words than anybody
will read standing up, glare that hides the object, and graphics specified in a
material that will not survive a month of hands.`,
};

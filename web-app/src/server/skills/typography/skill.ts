import "server-only";
import type { Skill } from "@/server/skills/skill";

export const typography: Skill = {
  name: "typography",
  kind: "foundation",
  title: "Typography",
  summary:
    "Type anatomy, pairing, scale ratios, measure, leading and tracking, and when a typeface is doing the talking.",
  text: `Type has anatomy, and the parts of it that matter at a distance are few. The
x-height — the height of a lowercase letter without an ascender — decides how
large a typeface looks at a given point size far more than the point size does,
which is why two faces set at the same size can look a size apart. Stroke
contrast, the difference between a letterform's thick and thin strokes, decides
how it survives being made small or being reversed out of a dark ground: high
contrast faces lose their thin strokes first. Counters, the enclosed spaces
inside letters, close up as size drops and are the reason a face designed for
headlines becomes mud at caption size.

The broad categories carry associations before a word is read. Serifs read as
traditional, editorial, literary; the old-style ones read as warm and the
high-contrast moderns as formal and expensive. Sans serifs read as modern,
neutral, functional, and the geometric ones read as colder than the humanist
ones. Scripts read as personal, ceremonial or hand-made, and they are the
easiest to overuse — set in all capitals or at length they become unreadable,
because the letterforms were drawn to connect in lowercase. Display faces are
for one line at large size and nothing else. Monospace reads as technical or
archival.

Pairing works on contrast, not on similarity. Two faces that are close but not
identical look like a mistake; two that are plainly different look like a
decision. The reliable pairing is a strong display or serif face for headlines
with a quiet, high-x-height sans for body text, or the reverse. A single family
with a wide range of weights will do the same job on its own, and one family
used with real weight contrast is almost always better than two families used
timidly. Three families on one piece is nearly always one too many.

Scale wants a ratio rather than arbitrary sizes. Picking a base size for body
text and multiplying by a constant — 1.2 for a quiet scale, 1.25 or 1.333 for a
usable one, 1.5 or 1.618 for a dramatic one — gives a set of sizes that look
related because they are. The important property is not the specific ratio but
that the steps are distinct: sizes two points apart read as an error rather
than as a hierarchy, and a scale with six steps where three would do produces a
page where nothing is clearly more important than anything else.

Measure is the length of a line of text and it is the most commonly ignored
variable. Somewhere between 45 and 75 characters per line is comfortable for
continuous reading; longer and the eye loses its place returning to the left
edge, shorter and the reading rhythm breaks up. Wide columns of small text are
the standard failure, and the fix is a narrower column rather than more space
between the lines. Short bursts — a sign, a headline, a caption — have far more
latitude, and a headline broken at a phrase rather than at the column edge
always reads better.

Leading, the vertical distance between baselines, is set relative to size.
Body text usually wants something between 1.4 and 1.6 times its size; the wider
the measure the more it needs, because the extra distance the eye travels
sideways needs more vertical separation to land in the right place. Large type
needs proportionally less — headlines set at body-text leading ratios look
loose and drifting, and tightening a headline's leading until the lines almost
touch is a large part of what makes display typography look set rather than
typed. Leading tighter than the type's own body makes ascenders and descenders
collide and is only ever a deliberate effect.

Tracking is the space between all the letters, kerning is the space between one
specific pair. Large type wants tracking pulled in — a headline at the default
spacing of a face optimised for text will look gappy — and small type wants it
opened slightly. Text set in all capitals always wants opened tracking, because
capitals were never drawn to sit next to each other in long runs. Kerning is a
per-pair repair for combinations that leave holes: an uppercase A beside a V,
or a T over a lowercase o. Holes are visible in headlines and invisible in body
text, so the effort belongs where it shows.

Alignment is structural. Ranged left with a ragged right edge is the easiest to
read and the safest default. Justified text needs a wide enough measure to
avoid rivers of white running down the column, and without hyphenation it
usually gets them. Centred text is formal and ceremonial, which is why
invitations use it, and it is very hard to read for more than a few lines
because every line starts in a different place. Ragged right edges are worth
tidying by hand: a rag that alternates long and short reads as deliberate,
while one that makes a wedge or an unintended shape draws attention to itself.

Hierarchy in type comes from a small number of levers used decisively — size,
weight, case, colour, and space. Using one of them strongly is more effective
than using four of them weakly, and a heading that is bigger, bolder, upper
case, coloured and spaced is shouting five times. Space is the most underused
of them: more room above a heading than below it groups the heading with what
it introduces, and that single relationship does more for a page's structure
than any change of size.

A typeface can do the talking or get out of the way, and both are legitimate,
but not on the same piece. Where the words are the message — a name, a date, a
single line on a sign — a face with character earns its place and the rest of
the layout should be quiet around it. Where the words are information to be got
through, the face's job is to be invisible, and any personality in it will be
paid for in reading time.

All of this lands on a choice of real families, weights and italics, and the
open Google Fonts library carries thousands. Which named face carries which
intent — display, text, voice and pairing — is the type-faces-display,
type-faces-text and type-faces-voice foundations' ground.`,
};

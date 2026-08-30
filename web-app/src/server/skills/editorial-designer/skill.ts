import "server-only";
import type { Skill } from "@/server/skills/skill";

export const editorialDesigner: Skill = {
  name: "editorial-designer",
  kind: "occupation",
  title: "Editorial Designer",
  summary:
    "Magazines and features: covers and cover lines, openers, pacing across a feature, pull quotes, and a template with range.",
  text: `Editorial design is the arrangement of text and pictures over many pages under a
deadline that returns. Two things follow from that: the work is paced, because a
reader moves through it rather than looking at it, and the work is systematic,
because the same problems arrive every issue and nobody has time to solve them
from nothing.

A magazine has a shape — front of book, features, back of book. The front is
short, dense, many small items to a page, and it teaches the reader the
publication's voice. Features are long, slow, and are where the design is allowed
to be different every time. The back returns to a regular rhythm. That structure
is what stops a hundred pages reading as a hundred separate designs.

Pacing is the craft. The reader turning pages should meet variation: a full-bleed
photograph, then a quiet two-column text spread, then a spread broken into small
elements. Two identical layouts in a row put a reader to sleep; ten different
ones in a row exhaust them. A flat plan — every spread at thumbnail size in
order — is how pacing is checked, and it catches problems no single spread can
show.

The opener carries the feature. It has one job, which is to make somebody stop
and start reading, and its elements are few: an image with room in it, a title
set larger than anywhere else in the publication, a standfirst of one or two
sentences that says what the piece is, and a byline. Openers work when they are
uncluttered; the second spread is where information density is allowed to return.

Type in editorial is a hierarchy applied at speed: headline, standfirst, body,
crosshead, caption, pull quote, folio and credit. Each has a fixed treatment, so
that a spread built at midnight is still correct. Body text is the part nobody
notices and everybody reads — a measure of 45 to 75 characters, generous leading,
justified only where the column is wide enough for it not to open rivers of white.

A pull quote is a navigational device, not decoration. It exists to give a reader
skimming a page a reason to enter it, so it should be the most interesting
sentence available and must not repeat the standfirst. Captions are read more
often than body text and deserve more care than they usually get.

Pictures are edited, not placed. Cropping to give a subject somewhere to look,
scaling so the reader can tell what is important, and running one picture large
enough to be worth the paper are all editorial judgements. Facing pages are one
image: a spread is designed across the gutter, and anything critical — a face, a
line of type — must not fall into it.

The cover is a different discipline again. It is an advertisement seen small
among competitors, so it needs a single dominant image, a masthead that survives
being partly covered, and cover lines ranked so that one is clearly the main one.
Cover lines are written to the space; a hierarchy where everything is important
sells nothing.

A template is what makes all of this repeatable: a grid with enough columns to
allow narrow and wide elements, defined styles for every text role, and stated
margins and folio positions. It has to allow range — the same grid producing a
quiet text feature and a loud photographic one — or every issue will fight it.

The failure modes: an opener as busy as an interior spread, pull quotes that
repeat the headline, a picture run at a size that makes its subject unreadable,
type crossing the gutter, and a flat plan nobody looked at until the issue was
already at the printer.`,
};

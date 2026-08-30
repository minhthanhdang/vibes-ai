import "server-only";
import type { Skill } from "@/server/skills/skill";

export const bookDesigner: Skill = {
  name: "book-designer",
  kind: "occupation",
  title: "Book Designer",
  summary:
    "Long-form text on paper: the text block and margins, a type scale for reading, front matter and running heads, cover and spine.",
  text: `Book design is the design of something that will be read for hours. Almost every
decision therefore serves comfort and consistency rather than impact, and the
best interior design is the one a reader never notices while reading and finds
pleasant when they look up.

The text block and the margins are the whole interior composition. The
proportions of the block, its position on the page and the relative sizes of the
four margins are set once and govern hundreds of pages. The traditional
progressions put the inner margin smallest, then the top, then the outer, with
the foot largest — which places the block slightly above centre and gives the
thumbs somewhere to sit. The inner margin must also account for how the binding
swallows page near the spine, and a book bound too tightly with too narrow a
gutter is unreadable regardless of how good the typography is.

Reading type is chosen for its behaviour at text size rather than its personality
at display size: a generous x-height, sturdy but not heavy strokes, and even
colour on the page. Size, measure and leading are decided together — roughly 9 to
12 points depending on the face, a measure of 60 to 70 characters, and leading of
2 to 4 points more than the size, opened up as the measure gets wider. The test
is the grey of a full page seen out of focus: even, without rivers, without
stripes, without lines so tight the eye cannot find the next one.

Justified setting is the tradition for books and needs hyphenation to avoid
loose lines; ranged left is easier to set well and is normal in illustrated and
academic work. Paragraph indication is either a first-line indent or a space, but
never both, and the first paragraph after a heading takes no indent.

Consistency across the book comes from a small set of defined elements: chapter
openers that always start on the same relative page position, headings at fixed
levels, running heads that tell a reader where they are, and folios in a
consistent place. Vertical rhythm — baselines aligning across a spread and from
recto to verso — is what makes an opening look composed rather than assembled.

Front and back matter have an established order that readers rely on: half title,
title page, copyright, dedication, contents, then the text, with notes,
bibliography, index and colophon at the back. Blank versos are correct, not
mistakes; chapters conventionally open on a recto.

Page management is the invisible craft. Widows and orphans are eliminated, facing
pages are kept equal in depth, and text is nudged by a line or by fractional
spacing rather than by re-flowing everything. Illustrated books add the problem
of anchoring images near their references without wrecking the flow.

The physical object is designed too: trim size according to genre and hand feel,
paper chosen for opacity, bulk and shade — cream is easier on the eye for long
reading — grain running parallel to the spine so the book opens flat, and a
binding suited to the use. Extent is worked in signatures, usually multiples of
sixteen pages, which decides how much room the design actually has.

The cover is a separate discipline: it must work as a small thumbnail, survive
being seen spine-out on a shelf, and place the title and author in a hierarchy
that suits the market. The spine needs its width calculated from the paper bulk,
and the type on it needs to be legible at an angle from a metre away.

The failure modes: a measure far too wide, leading too tight, an inner margin
that vanishes into the binding, running heads nobody needs, widows left standing,
a cover designed only at full size, and a chapter opener that changes position
halfway through the book.`,
};

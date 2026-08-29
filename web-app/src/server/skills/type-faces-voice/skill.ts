import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Type faces: voice — a foundation (compositor-v2.md §V.2).
export const typeFacesVoice: Skill = {
  name: "type-faces-voice",
  kind: "foundation",
  title: "Type faces: voice",
  summary:
    "Matching face to intent — sector voices, proven pairings, and the craft of weight and italic across the open library.",
  text: `Every sector has a typographic voice, and a face fighting its sector reads as
a mistake before a word is understood. Luxury and fashion speak high-contrast
serif — Playfair Display, Bodoni Moda, Prata, Italiana — in few weights, wide
tracking on small capitals, and never bold body text. Editorial speaks serif
text under serif or grotesque display: Lora or Source Serif 4 under Playfair
Display is the classic magazine chord, Newsreader under Anton the tabloid
one. Tech and product speak grotesque and geometric sans — Inter, Manrope,
Space Grotesk, DM Sans — dark-mode-ready, with a mono like JetBrains Mono or
Space Mono for the data notes. Finance and law want gravity without fashion:
Source Serif 4, Libre Baskerville, IBM Plex Serif over IBM Plex Sans, and
navy-adjacent restraint. Food and family speak rounded — Fredoka, Baloo 2,
Nunito, Quicksand — or hand-made: Caveat for the note, Pacifico for the
diner. Weddings and ceremony speak script over classical serif: Great Vibes
or Parisienne for the names, Cormorant Garamond or EB Garamond for
everything else. Sport and streetwear speak condensed capitals — Bebas Neue,
Oswald, Archivo Black — at sizes that crowd the frame. Culture and festivals
can afford the strange ones: Unbounded, Syne, Bungee, Fraunces at its
wonkiest.

Pairings that reliably work share a logic, not a look. Contrast of category:
Playfair Display with Lato, Abril Fatface with Work Sans, Cormorant Garamond
with Montserrat, Fraunces with Inter — display serif against quiet sans, each
doing what the other cannot. Contrast of era in the same category: Space
Grotesk over Inter, Archivo Black over Archivo, Oswald over Open Sans.
Superfamilies remove the guesswork: IBM Plex Sans, Serif and Mono are drawn
together, as are the Roboto and Noto families, and Source Sans, Serif and
Code. A pairing of two display faces, or two text faces of the same category
and weight, is the common failure — nothing leads.

Weight is the loudest knob after size, and numeric weights are a shared
scale: 100 and 200 are hairlines that only survive very large and over quiet
grounds; 300 is refined body for generous sizes; 400 is reading weight; 500
and 600 are the emphasis-and-subhead band, and 500 is the honest body weight
for light type reversed out of dark; 700 is the standard bold; 800 and 900
are display weights that need room. A hierarchy reads cleanest with two
weights well apart — 400 with 700, 300 with 600 — and a step of one hundred
reads as a rendering error, not a hierarchy. Heavy display cuts, Archivo
Black or Playfair Display 900, want tighter tracking; hairlines want a touch
more.

Italic is emphasis, aside and quotation, not decoration. In the reading
serifs — EB Garamond, Lora, Alegreya, Spectral — the italic is a genuinely
different, calligraphic drawing, beautiful for pull quotes, photo credits
and editorial asides. In most sans faces the italic is a polite slant and
says little; emphasis inside sans text is better done with weight. A
high-contrast serif italic like Playfair Display's is a display instrument
of its own — one line, a name, a date. Whole paragraphs in italic, or italic
plus bold plus capitals on one line, are the marks of shouting.

Some faces are one-cut by design — Bebas Neue, Abril Fatface, Prata, Alfa
Slab One, most scripts — and asking them for weights or italics misreads
what they are: the cut is the identity, and the hierarchy around them comes
from a partner family. The variable-range families — Fraunces, Sora, Lexend,
Manrope, Literata — go the other way, carrying a whole system in one name.

The strongest identities on the open library are usually two families and
three cuts in total: a display voice at one heavy weight, a text voice at
400 and 700, a mono or script only when the content genuinely calls for it.
Every additional face after that costs more than it says.`,
};

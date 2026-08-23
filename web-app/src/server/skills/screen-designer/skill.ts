import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Screen designer — an occupation (compositor-v2.md §V.2).
export const screenDesigner: Skill = {
  name: "screen-designer",
  kind: "occupation",
  title: "Screen Designer",
  summary:
    "Layouts made for screens: viewport and breakpoints, the fold, density, touch targets, state, and scroll as a sequence.",
  text: `A screen layout is not a page at an unknown size, it is a layout that has to be
correct at every size, on hardware whose dimensions were never agreed with
anybody. That single difference drives the whole craft: nothing can be positioned
absolutely, everything is a relationship, and the design is really a set of rules
for how a composition rearranges itself.

The viewport is the frame and it is variable. Breakpoints are the sizes at which
the arrangement changes shape rather than merely stretching — commonly a
single-column phone layout, a two-column tablet layout and a wider desktop
layout. Good breakpoints are chosen where the content breaks, not where a
popular device happens to sit; the honest test is to resize continuously and
watch for the width at which a line gets too long or a column too narrow to hold
its content.

Measure governs the width of a text column exactly as it does in print: around
45 to 75 characters. A full-width paragraph on a wide display is a layout that
forgot the reader, and it is the most common single fault in screen work.

The fold is real but overstated. People scroll without being asked; what they do
not do is scroll past something that looks finished. The rule that holds is that
the top of the screen must make the purpose of the page clear and must not look
like a natural ending, and anything that looks like a closing element high up
will stop the scroll.

Scroll is a sequence, which makes a long page closer to an edit than to a poster.
Sections have a rhythm — a wide image, then a narrow text block, then a row of
items — and the pacing of that alternation is what stops a page from reading as
an undifferentiated column. Vertical spacing between sections should be
noticeably larger than spacing inside them, or the sequence loses its joints.

Density is a decision, not an accident. A dashboard for people who look at it all
day should be dense; a marketing page should be sparse. What matters is
consistency: a spacing scale with a small number of steps, applied everywhere,
which is what makes a layout look designed rather than assembled.

Touch adds physical constraints. A target should be around 44 points square at
minimum, with real space between neighbours; the bottom of a phone screen is
reachable and the top corners are not, which is why primary actions have
migrated downward. Hover does not exist on touch, so nothing important may be
hidden behind it.

State is the part with no print equivalent and it is half the work. Every
interactive element needs a resting, hover, focus, active and disabled
appearance, and focus in particular has to be visible because it is how a
keyboard is navigated. Every region that loads data needs an empty state, a
loading state and an error state designed, not improvised — the empty state is
often the first thing a new arrival sees and is worth more attention than the
full one.

Contrast has a measurable floor: body text should reach a ratio of about 4.5 to 1
against its background, and large text about 3 to 1. Colour alone may not carry
meaning, because a meaningful share of readers will not see the difference.

Motion is functional here rather than decorative: it explains where something
came from and where it went. Durations in the range of 150 to 300 milliseconds
read as responsive; anything slower is felt as lag, and anything that moves
without explaining a change is noise.

The failure modes: a design made at one width and never tested at another, text
that reflows into a two-word column on a phone, tap targets sized for a mouse,
states left undesigned so the implementation invents them, and images specified
at a fixed height so that a taller screen crops the subject out.`,
};

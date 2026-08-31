import "server-only";
import type { Skill } from "@/server/skills/skill";

export const myTaste: Skill = {
  name: "my-taste",
  kind: "foundation",
  title: "My taste",
  summary:
    "One designer's taste for the calls a brief leaves open. Intention always outranks it; where intention is unclear or silent, this decides.",
  text: `Every other skill in this folder is the trade speaking; this one is a single
designer speaking. A received design intention — the brief, the direction, the
stated wish — outranks everything below, down to its smallest detail. This file
is for when that intention is not clear enough to design from, and it governs
only the choices the intention leaves open: where the two touch, intention wins
without argument; where the intention is silent, this is what the silence
sounds like.

I start from a quiet ground with life in it — a warm off-white carrying a
paper texture, a wash, a faint gradient; a perfectly flat colour is the start
of a ground, not the end of one — under near-black ink, never pure white
under pure black, which reads as a default nobody chose. One accent appears
rarely enough to mean something, and text carries the design until something
earns its place beside it. I would rather ship a page that is only
type than a page that is only decoration, and given a day to improve a design
I would spend most of it on the typography.

Colour: muted, slightly desaturated palettes with a single saturated accent.
Warm neutrals over cool ones — pure grey looks unfinished, and blue-grey looks
like every dashboard shipped this decade. For the accent I reach past the
industry defaults — a deep green, a burnt orange, an oxblood, an inky teal —
before I will ship the blue-to-purple gradient that has become the sound of
one specific era. Accent colour is a budget: the more places it appears, the
less any of them means, so links, one button per view, the one data series
that matters, and almost nothing else. Dark mode is a warm dark grey, never
black, and it is its own palette, not an inversion; the accent gets
desaturated in the dark, not brightened.

Type: a humanist grotesque for interface text, because it disappears — but
for anything editorial I want a real serif at display size; the grotesque
everywhere is competence without a voice. My scale takes big jumps: body at
16 and then straight to something huge, rather than five polite steps in
between — a 16/56 pair says more than 16/20/24/32/40 ever will. Display type
gets its tracking pulled tight; body sits at 1.5 and stays there. Any column
of numbers is set in tabular figures without being asked, and I would always
rather set text in a narrow measure with extravagant margins than let
anything run full-width.

Space: whitespace is the cheapest luxury there is, and when a layout feels
wrong I add space before I add rules, boxes, or backgrounds. Most boxes are
confessions that the alignment failed; delete the box and fix the alignment.
I prefer asymmetry to centring — content set left on a wide ground, the right
side breathing — and I centre something only when it is genuinely
ceremonial. One strong margin doing the work beats four timid equal ones.

Surfaces: hairline borders in a tint of the ink, over shadows. A shadow is a
claim that something floats, so only floating things get one — menus,
dialogs, a dragged card — and cards resting in a page layout do not. Corner
radii stay modest, six to ten pixels; pill shapes are for pills — tags,
toggles — not for every button on the page. Glass, blur, and translucency
are focus effects, not materials; a frosted card on a gradient mesh is the
costume of depth without the fact of it.

Motion exists to say what changed, not to perform. Small distances, 150 to
250 milliseconds, eased out, and then stillness. Nothing pulses, nothing
loops, nothing bounces while idle — an element that moves without cause is
spending the viewer's attention on itself. The test I trust: if cutting
every animation would improve the design, the animations were decoration; if
cutting them would leave what just happened unclear, they were earning their
keep.

Data: grey everything, then colour the one series the sentence is about.
Labels sit on the data, not in a legend the eye has to commute to. No 3D
ever, no donut where a number would do, and a large plain number with a
small sparkline beats most dashboards I have seen. The chart junk I cut
first: gridlines darker than the data, axis lines that box the plot,
backgrounds behind plots.

Imagery: no image over a stock image, every time — an abstract typographic
treatment is more honest than a rented photograph of people laughing at a
laptop. Diagrams get drawn in the page's own ink and accent so they belong
to the page. Photography earns its place by being full-bleed and specific or
it stays out. Generated imagery I will use for texture and abstract ground,
and not for anything containing hands, text, or a logo.

What I am tired of: the purple-to-blue gradient hero. Glass cards floating
on a mesh gradient. Emoji doing an icon's job. The three-column feature grid
where every cell is icon, title, two lines of the same sentence. Pill
buttons wearing drop shadows. Dark themes that are light themes inverted.
Confetti, and interfaces that congratulate. Each of these was once a choice;
they are now the absence of one.

Tie-breakers, for when the intention and the rules have both gone quiet:
remove the element in question first, and usually it is not missed. Between
two options the quieter one wins. Type before image, specific before generic
— "Send the invoice" over "Get started" — and of two designs that both
survive the blur test, ship the one with fewer colours. A boring layout with
excellent type beats a novel layout with default type, because the second is
a promise the content has to keep.`,
};

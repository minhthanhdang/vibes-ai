import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Type faces: display — a foundation (compositor-v2.md §V.2).
export const typeFacesDisplay: Skill = {
  name: "type-faces-display",
  kind: "foundation",
  title: "Type faces: display",
  summary:
    "The open-library display faces by name — headline serifs, impact sans, slabs, scripts — and what each one is for.",
  text: `A display face is chosen for one line at large size, and the open Google Fonts
library carries every register of them. Knowing the families by name is the
difference between "a serif headline" and the right serif headline: each of
these earns its place at forty pixels and up, and most of them fall apart as
body text — counters close, thin strokes vanish, personality curdles into
noise. One display face per piece is the working rule; the second one has to
fight the first.

The high-contrast display serifs are the luxury and editorial register.
Playfair Display is the workhorse — thick-thin contrast, sharp serifs, a proper
italic; a headline over a quiet photograph, a fashion cover, a wedding name.
Bodoni Moda is the same idea pushed further, colder and more couture. Abril
Fatface is a single fat cut with enormous presence — one word, poster-sized.
DM Serif Display is rounder and friendlier, a magazine headline that still
smiles. Prata is a one-weight display serif with a Vogue-like coolness;
Italiana is thinner and more fragile still. Fraunces is the soft, wonky revival
— warm, slightly retro, wonderful heavy — and Young Serif and Instrument Serif
carry the same contemporary-editorial energy in one cut each. Yeseva One and
Gilda Display lean romantic; Rozha One and Ultra are ink-heavy statements.

The classical register is quieter: Cormorant Garamond is a delicate
old-style display with real italics, at home on anything ceremonial; Cinzel is
Roman capitals — monuments, law, antiquity — and Marcellus pairs those
inscriptional capitals with a lowercase. EB Garamond and Libre Caslon Text
step down toward text but still carry a headline with dignity.

The impact sans are the shout. Bebas Neue is the tall condensed
all-capitals poster voice — sport, streetwear, countdowns. Anton is wider and
heavier, a tabloid front page. Archivo Black and Alfa Slab One are solid
blocks of ink, the second with slab feet. Oswald is the usable middle: a
condensed gothic that still works at a range of sizes and weights. Barlow
Condensed and Roboto Condensed are the quieter condensed voices for kickers,
labels and space-starved rows. League Spartan is geometric and confident;
Staatliches and Fjalla One are compact display gothics with civic and
editorial tempers; Passion One, Titan One and Paytone One are loud, round and
pop. Unbounded and Syne are the contemporary art-school register — expanded,
a little strange, right for festivals and web3-adjacent brands; Bungee and
Righteous are signage and retro-arcade.

The slabs read sturdy and honest: Alfa Slab One at full volume, Zilla Slab
and Josefin Slab at conversational weight, Arvo and Roboto Slab when a
headline wants weight without contrast, Ultra when it wants to be a woodcut.

The scripts and hands are ceremony and personality, always in
mixed case and never at length. Great Vibes, Allura, Pinyon Script and
Parisienne are formal calligraphy — invitations, certificates, "& Sons".
Dancing Script and Kaushan Script are livelier, brush over copperplate.
Pacifico, Yellowtail, Satisfy and Lobster are retro-commercial scripts, diner
and label energy — Lobster especially is charming once and exhausting twice.
Caveat, Shadows Into Light, Amatic SC and Homemade Apple are handwriting
rather than calligraphy: annotation, warmth, a note in a margin. Permanent
Marker is exactly what it says. A script never sets in all capitals — the
letterforms were drawn to connect — and never carries more than a phrase.

The rounded and friendly register sits between display and text: Fredoka,
Baloo 2, Comfortaa, Quicksand and Varela Round read as approachable, young,
food-and-family; at heavy weights they carry children's brands, at light ones
wellness. Josefin Sans is elegant art-deco geometry, beautiful in light
capitals with open tracking.

Weight is part of the choice: most of these families are cut once, but the
ones with ranges — Playfair Display, Fraunces, Oswald, Baloo 2 — do their
display work at the top of that range, 700 and up where the family carries
it, and their lighter cuts are a different, quieter instrument.`,
};

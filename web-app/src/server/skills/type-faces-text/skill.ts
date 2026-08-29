import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Type faces: text — a foundation (compositor-v2.md §V.2).
export const typeFacesText: Skill = {
  name: "type-faces-text",
  kind: "foundation",
  title: "Type faces: text",
  summary:
    "The open-library text faces by name — body sans, reading serifs, monospace — and which one carries which kind of page.",
  text: `A text face is judged at reading size, where anatomy beats personality: a
generous x-height, open counters, low-to-moderate stroke contrast, and enough
weights to build hierarchy inside one family. The open Google Fonts library
carries a deep bench of them, and they are not interchangeable — each has a
temperature.

Among the sans serifs, the humanist ones read warmest. Open Sans, Lato and
Source Sans 3 are the transparent workhorses — interfaces, reports, anything
that must simply be read. Karla and Cabin have a little more hand in them;
Mulish and Figtree are the newer, cleaner takes. PT Sans and Noto Sans are the
wide-coverage internationalists. The grotesques read more neutral and urban:
Inter is the interface standard — tall x-height, tight spacing, superb at
small sizes; Roboto is Android's voice and disappears entirely; Work Sans and
Archivo are print-flavoured grotesques happy at both text and headline;
Hanken Grotesk, Schibsted Grotesk and Instrument Sans are the contemporary
editorial grotesques; Space Grotesk carries a techy, slightly quirky edge that
pairs naturally with monospace. Barlow is a big, slightly rounded family with
condensed companions, good wherever signage meets text.

The geometrics read designed rather than neutral: Montserrat is the
ubiquitous modern-brand voice, better in headlines and capitals than in long
text; Poppins is rounder and friendlier, at home in product marketing; DM Sans
is the quiet geometric for interfaces; Jost is the Futura register; Urbanist
and Outfit are light-feeling brand geometrics; Sora and Lexend are engineered
for screens, Lexend specifically for reading ease; Manrope and Plus Jakarta
Sans sit between geometric and grotesque and flatter almost any modern
identity; Raleway is elegant and thin-first, best in display weights of text
settings like navigation; Rubik's soft corners read casual; Albert Sans and
Onest are current, rounder Scandinavian-feeling defaults. IBM Plex Sans is
the engineered corporate voice with a matching serif and mono.

The reading serifs divide by era. The old-styles are warm and bookish:
EB Garamond is the classic — literary, humanist, at its best in print-like
settings; Crimson Pro and Cardo carry the same scholarly register; Alegreya is
livelier, drawn for literature with a spark; Vollkorn is sturdy bread-and-
butter reading. The transitionals and moderns read more editorial: Lora is
the dependable web serif — calligraphic roots, works everywhere; Merriweather
is built for screens at small sizes; Source Serif 4 and Literata are
contemporary reading faces (Literata was drawn for e-books); Spectral is airy
and magazine-like; Newsreader is drawn for news text; Libre Baskerville sets
wide and bright at text sizes; PT Serif and Noto Serif are plain reliable;
Frank Ruhl Libre and Domine carry more presence in short paragraphs; STIX Two
Text is the scholarly-journal register; Petrona and Bitter (a slab) hold up
on rough screens. Playfair Display and its display kin do not belong here —
high contrast at twelve pixels is sparkle and eyestrain.

The slab serifs for text — Roboto Slab, Zilla Slab, Bitter, Arvo — read
sturdy, technical and a little retro; they make good captions and specs.

Monospace is a voice, not just a code font. JetBrains Mono and Fira Code
are the programmer's faces (Fira Code with ligatures); Source Code Pro,
Roboto Mono and IBM Plex Mono are the neutral corporate monos; Space Mono is
the stylish one — headline-capable, NASA-transcript flavour; DM Mono is its
quieter sibling; Inconsolata is humanist and friendly; Courier Prime is the
screenplay and typewriter register; Azeret Mono and Martian Mono are chunky
contemporary display monos. Tabular figures, timestamps, coordinates,
captions and anything that should feel like data all justify a mono even
where no code appears.

Building hierarchy inside one family beats adding families: Inter, Archivo,
Manrope, Sora and Source Serif 4 carry 300 through 800 and most of the faces
above run nearly as wide, which is headline, subhead, body and caption from
one drawing.
The body weight is almost always 400, bumped to 500 when reversed out of a
dark ground, and real italics — not slanted romans — are part of what
separates the reading serifs above from cheaper defaults.`,
};

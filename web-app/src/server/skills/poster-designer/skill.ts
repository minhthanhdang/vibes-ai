import "server-only";
import type { Skill } from "@/server/skills/skill";

export const posterDesigner: Skill = {
  name: "poster-designer",
  kind: "occupation",
  title: "Poster Designer",
  summary:
    "One image, one message, seen at distance: hierarchy at a glance, standard sizes, print constraints, and the wall it hangs on.",
  text: `A poster is a single surface that has to work at two distances: from across a
street, where it is a shape and a colour and possibly three words, and from a
metre away, where the details are read. Designing for only one of those distances
is the most common failure in the form.

The distance test governs the hierarchy. There is one thing to be seen first —
an image, a word, a shape — and it should be identifiable at thumbnail size and
in peripheral vision. Second comes the information that makes the first thing
actionable: what it is, when, where. Third is everything else, which can be set
small because anybody reading it has already stopped walking. Three levels is
usually enough; a poster with five is a poster with none.

Scale is the medium's characteristic tool. Posters can carry type larger than any
other printed thing, and the strongest work usually pushes one element far beyond
what looks comfortable on a screen — a letterform cropped by the edge, a face
filling the sheet, a single object at life size. Timidity of scale is what makes a
poster look like an enlarged flyer.

Standard sizes matter because posters live in fixed frames and on fixed walls:
the international A series, and the imperial and metric sheet sizes used by
printers and by outdoor sites. Format proportion is part of the design, and a
composition made for a square will not simply crop to a tall sheet.

The wall is context. Posters are rarely seen alone; they are pasted in rows, next
to competitors, in bad light, partly overlapped, sometimes weathered. A design
whose distinctiveness depends on its white margin will lose it. Repetition is
worth exploiting — a poster tiled several times across a hoarding creates a
pattern the single sheet does not have.

Print constraints shape the work. Large-format printing is often done at lower
resolution than a hand-held piece needs, because it is viewed from further away;
ink coverage limits apply on cheap stock; a poster printed by screen or riso
wants flat colour and few inks. Colour has to be specified for the process, and a
strong solid field is more reliable across print runs than a subtle gradient.

Type on a poster is doing two jobs — being read and being an image. A single
distinctive face used at several sizes generally beats two faces fighting, and
letter spacing at very large sizes must be tightened, because tracking that looks
correct at text size opens up badly when scaled. Long lines of body copy do not
belong on a poster; the copy is edited down until it fits the hierarchy.

Image and type have to be composed together rather than layered afterwards.
Either the image leaves a genuinely quiet area for the words, or the words are
placed to interlock with the image's shapes, or the type is the image. A
photograph with a semi-transparent panel dropped over one corner is the default
solution and rarely the best one.

The margin is a decision: a generous white border frames and formalises, a full
bleed makes the sheet feel like a window or a wall. Neither is neutral, and a
narrow accidental margin looks like an error.

The failure modes: everything the same size, a message that needs two sentences
to land, an image whose subject vanishes at thumbnail size, type too tightly
crowded to the edge, and a design that has only ever been judged on a screen at
a fraction of its printed size.`,
};

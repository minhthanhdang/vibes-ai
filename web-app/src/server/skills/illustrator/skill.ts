import "server-only";
import type { Skill } from "@/server/skills/skill";

export const illustrator: Skill = {
  name: "illustrator",
  kind: "occupation",
  title: "Illustrator",
  summary:
    "Commissioned pictures that carry an idea: the brief, the concept, spot against full-page, and a style that reproduces.",
  text: `Illustration is picture-making with a job attached. Something else — an article,
a story, a product, a poster — needs an image, and the illustration exists to do
work for it. That is the difference from painting, and it is why the strongest
illustrations are usually the ones with the clearest single idea rather than the
most technique.

The idea comes before the drawing. The reliable process is to read the thing
being illustrated, find what it is actually about rather than what it depicts,
and make many small rough thumbnails of possible concepts before committing.
Editorial work in particular rewards the image that says something the text does
not — a metaphor, a visual pun, an unexpected point of view — and punishes the
image that merely re-describes the first paragraph.

Composition in illustration is heavily constrained by use. A spot illustration is
small, often silhouetted, has to read at a glance and cannot rely on background
or detail. A half-page or full-page image can hold a scene. A cover needs to
survive type over it and a great deal of empty space is a feature rather than a
fault. A children's book spread has to leave a place for the text and has to work
across a gutter. Knowing the placement before drawing is not a limitation, it is
the brief.

Reading order is engineered. Illustration is often looked at for under a second,
so the picture needs one clear entry point, a value structure that groups the
image into a few large shapes, and a silhouette that carries the subject. The
usual test is to reduce the image to a thumbnail or to squint at it: if the
subject is not immediately identifiable, no amount of rendering will fix it.

Colour is usually limited on purpose. Working within a small palette, sometimes
literally the two or three inks a publication uses, produces stronger images than
full-spectrum realism, and it is also what makes a body of work look like one
person's. Value is decided before hue: an illustration that works in greyscale
works in colour, and one that does not, will not.

Style is a working method, not a decoration. It is built out of consistent
decisions — line quality, level of abstraction, how edges are handled, palette,
texture — and it has to be repeatable under deadline and reproducible in the
medium it will be printed or displayed in. Fine texture disappears in newsprint;
subtle low-contrast colour disappears on a phone.

The commissioned side of the work is part of the craft. A brief should establish
the format, the placement, the deadline, the palette limits and how the image
will be reproduced. Sketches are submitted before finishing — usually two or
three genuinely different concepts rather than three versions of one — because a
disagreement at the sketch stage costs an hour and the same disagreement at the
finish costs a week. Delivery means the right resolution, the right colour space,
layers or a background where the client will need them, and a version that works
cropped.

Character and continuity matter in anything sequential: the same face has to be
the same face across forty pages, which is why model sheets and construction
methods exist, and why illustrators building series work develop shapes simple
enough to redraw consistently.

The failure modes: a picture with no idea, an image that repeats the headline, a
composition that ignores where the type will go, rendering poured onto a weak
drawing, and a style that cannot be produced twice on a deadline.`,
};

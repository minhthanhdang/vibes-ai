import "server-only";
import type { Skill } from "@/server/skills/skill";

export const digitalArtist: Skill = {
  name: "digital-artist",
  kind: "occupation",
  title: "Digital artist",
  summary:
    "Illustration and paint: rendering, edges, colour mixing, and what separates a finished piece from a polished sketch.",
  text: `Digital painting and illustration are built in passes, and the order of the
passes is most of the craft. Thumbnails first, at a size where only large shapes
are possible — a few centimetres across — because a composition that does not
work as four grey shapes will not be rescued by rendering. Then value: the whole
image resolved in light and dark alone, which is where the picture's structure is
actually decided. Then colour laid over the established values. Then rendering,
which is local and late. Then the final adjustments to the whole. Work done out
of that order is work done twice, and the most common way a piece fails is by
rendering an eye beautifully before the head's placement has been settled.

Values do more than colour does. Squinting at a piece, or desaturating it,
reveals whether the subject separates from its background; if it does not, no
amount of hue will fix it. A useful discipline is to restrict a picture to three
or four value groups — a light family, a mid family, a dark family — and to keep
the subject's value distinct from what is behind it at the point of interest. The
same rule produces the silhouette test: an image filled entirely black on white
should still be legible and interesting.

Colour is mixed rather than picked. A colour chosen straight from a picker is
usually too saturated and too pure, and a picture assembled from such colours
looks synthetic. Real surfaces take colour from what lights them and from what
surrounds them: a white wall in sunlight is warm, its shadow is cool because it is
lit by the sky, and a red object beside it throws red into that shadow. The
reliable habits are to shift hue as value changes rather than only lightening and
darkening one hue, to keep the most saturated colour for the smallest and most
important area, and to let the darkest darks and the lightest lights lose
saturation rather than gain it.

Edges are the single most underused instrument. Every boundary in a picture is
hard, soft or lost, and varying them is what separates a painting from a
colouring-in. Hard edges pull attention and belong at the focal point, at
form-turning boundaries in strong light, and where two objects are in contact.
Soft edges belong on the shadow side of a rounded form, in the distance, on
anything moving, and anywhere attention should not go. Lost edges — where a form
and its background reach the same value and the boundary simply disappears — are
what let a picture breathe, and a piece with a hard outline everywhere reads as
cut out and pasted down regardless of how well each piece is painted.

Rendering means describing how a surface takes light, and the parts are
consistent: a light side and a shadow side divided by a terminator, a core
shadow just inside that terminator, reflected light bouncing back into the
shadow from surroundings, a cast shadow that is darkest and hardest where the
object meets its ground, and an occlusion darkness in the crevices. Reflected
light is always darker than the light side — the most common rendering error is a
bounce so bright it flattens the form. Specular highlights sit on the surface and
take the light's colour rather than the object's; matte surfaces have broad dull
ones, glossy surfaces small sharp ones, metal has almost no diffuse component at
all and is nearly entirely reflection.

Texture and detail follow attention rather than being distributed evenly. A
finished piece has one region of highest detail and highest contrast and lets
everything else fall away by degrees; a piece rendered uniformly across its
surface is exhausting and reads as unfinished even when far more work went into
it. Detail also has a scale hierarchy — large forms, then the forms on those
forms, then surface — and skipping to surface texture before the large form is
correct produces the characteristic busy, mushy result.

Different registers are legitimate and want different treatment. Flat vector-like
illustration abandons rendering and does its work through shape, colour and
edge quality alone, so its shapes must be far more considered. Painterly work
leaves visible strokes and depends on economical, confident marks; ten strokes
that describe a form beat a hundred that blend it away. Rendered realism carries
the most information and the least personality. Line-led illustration puts the
drawing first and uses colour as fill, which means line weight — heavier for
contour and closer forms, lighter for interior detail — is doing the structural
work.

A piece is finished when the values read at thumbnail size, the focal point has
the highest contrast and hardest edges in the image, the colour has a dominant
temperature with a deliberate accent against it, edges vary, and detail thins
away from the centre of interest. Anything else is polish applied to an unsolved
picture.`,
};

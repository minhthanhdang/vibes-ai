import "server-only";
import type { Skill } from "@/server/skills/skill";

export const threeDArtist: Skill = {
  name: "3d-artist",
  kind: "occupation",
  title: "3D Artist",
  summary:
    "Building and lighting in three dimensions: topology, materials and shading, camera and render, and why a scene looks fake.",
  text: `Working in three dimensions replaces drawing with building. The image is not
made directly; a model, a set of materials, lights and a camera are made, and the
picture is a consequence. Most of the craft is knowing which of those four is
responsible when the result looks wrong, and the answer is usually the lighting
or the materials rather than the geometry.

Topology is the layout of the polygons on a surface, and it matters for reasons
that are invisible in a still: edge loops need to follow the forms and to
concentrate where a surface deforms or curves sharply, quads behave predictably
where triangles and n-gons do not, and even spacing keeps a subdivided surface
smooth. A model that will bend needs loops at the joints; a model that will never
move can be built far more loosely.

Scale should be real from the start. Building at true-world dimensions means that
physical light units, depth of field, and any physics behave sensibly and that
assets from different sources sit together. Scenes built at arbitrary scale
produce lighting that cannot be reasoned about.

Materials are described by how a surface responds to light rather than by colour.
The physically based vocabulary is consistent across tools: a base colour,
roughness — which controls how tight or spread a reflection is and is the single
most expressive control — a metallic switch that changes the whole model of
reflection, normal or bump detail for fine surface irregularity, and transmission
for glass and liquids. Almost nothing in the world is perfectly smooth or
perfectly uniform, so variation in roughness across a surface, driven by a map,
is what stops materials looking like plastic.

Texturing follows the same principle: real surfaces carry history. Edge wear
where things are handled, dirt in crevices, fingerprints, dust that settles on
upward faces. Layering those on top of a clean material is what makes an object
look manufactured and used rather than generated.

Lighting is the discipline that carries over directly from photography. A key
light establishes form and its size relative to the subject decides how hard the
shadows are; fill controls contrast; rim separates a subject from its background.
Image-based lighting from a captured environment gives plausible ambient light
and, importantly, gives reflections something real to reflect — a shiny object in
an empty scene looks wrong because there is nothing around it.

Camera choices are photographic too: focal length changes the relationship
between near and far, depth of field directs attention and signals scale, and
composition rules apply exactly as they do in a photograph. A perfectly level,
symmetrical, wide-lens default view is the strongest single indicator of an
unconsidered render.

Rendering is a set of trade-offs between noise, time and accuracy: sample counts,
bounce limits, denoising, and the choice between path tracing and a real-time
engine. Output in a high dynamic range format leaves room to grade afterwards,
and rendering in passes — direct, indirect, reflection, depth, masks — makes
compositing possible, which is where most of the final look is decided.

Compositing finishes the image. Grading, subtle glare or bloom, a little chromatic
aberration and grain, and depth-based atmospheric haze are what remove the
sterility of a raw render.

The failure modes: uniform roughness everywhere, no imperfection anywhere,
lighting with a single hard source and no ambient, a scene with nothing for
reflective surfaces to reflect, arbitrary scale, and a technically clean render
with no photographic decision anywhere in it.`,
};

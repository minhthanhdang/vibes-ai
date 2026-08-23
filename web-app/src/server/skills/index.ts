import "server-only";
import type { Skill, SkillKind } from "@/server/skills/skill";
import { albumDesigner } from "@/server/skills/album-designer/skill";
import { animator } from "@/server/skills/animator/skill";
import { architect } from "@/server/skills/architect/skill";
import { artDirector } from "@/server/skills/art-director/skill";
import { bannerDesigner } from "@/server/skills/banner-designer/skill";
import { bookDesigner } from "@/server/skills/book-designer/skill";
import { brandDesigner } from "@/server/skills/brand-designer/skill";
import { characterArtist } from "@/server/skills/character-artist/skill";
import { cinematographer } from "@/server/skills/cinematographer/skill";
import { collageArtist } from "@/server/skills/collage-artist/skill";
import { colourTheory } from "@/server/skills/colour-theory/skill";
import { comicArtist } from "@/server/skills/comic-artist/skill";
import { composition } from "@/server/skills/composition/skill";
import { conceptArtist } from "@/server/skills/concept-artist/skill";
import { depthAndSpace } from "@/server/skills/depth-and-space/skill";
import { digitalArtist } from "@/server/skills/digital-artist/skill";
import { editorialDesigner } from "@/server/skills/editorial-designer/skill";
import { environmentArtist } from "@/server/skills/environment-artist/skill";
import { exhibitionDesigner } from "@/server/skills/exhibition-designer/skill";
import { fashionStylist } from "@/server/skills/fashion-stylist/skill";
import { floralDesigner } from "@/server/skills/floral-designer/skill";
import { gridSystems } from "@/server/skills/grid-systems/skill";
import { illustrator } from "@/server/skills/illustrator/skill";
import { industrialDesigner } from "@/server/skills/industrial-designer/skill";
import { interiorStylist } from "@/server/skills/interior-stylist/skill";
import { letteringArtist } from "@/server/skills/lettering-artist/skill";
import { lightAndShadow } from "@/server/skills/light-and-shadow/skill";
import { logoDesigner } from "@/server/skills/logo-designer/skill";
import { motionDesigner } from "@/server/skills/motion-designer/skill";
import { packagingDesigner } from "@/server/skills/packaging-designer/skill";
import { photographer } from "@/server/skills/photographer/skill";
import { posterDesigner } from "@/server/skills/poster-designer/skill";
import { presentationDesigner } from "@/server/skills/presentation-designer/skill";
import { printmaker } from "@/server/skills/printmaker/skill";
import { productionDesigner } from "@/server/skills/production-designer/skill";
import { screenDesigner } from "@/server/skills/screen-designer/skill";
import { storyboardArtist } from "@/server/skills/storyboard-artist/skill";
import { styleAndPeriod } from "@/server/skills/style-and-period/skill";
import { tattooArtist } from "@/server/skills/tattoo-artist/skill";
import { textileDesigner } from "@/server/skills/textile-designer/skill";
import { textureAndMaterials } from "@/server/skills/texture-and-materials/skill";
import { threeDArtist } from "@/server/skills/3d-artist/skill";
import { typeAndImage } from "@/server/skills/type-and-image/skill";
import { typography } from "@/server/skills/typography/skill";
import { uxDesigner } from "@/server/skills/ux-designer/skill";
import { visualHierarchy } from "@/server/skills/visual-hierarchy/skill";
import { weddingDesigner } from "@/server/skills/wedding-designer/skill";

/// The skill registry (compositor-v2.md §V.1).
///
/// Forty-seven modules imported by name rather than a directory read, and that
/// is the point of the whole arrangement: a bundler can trace an import and
/// cannot trace a `readFileSync`, so a skill that works locally and 500s in
/// production is not a shape this can take. Being typed is the second half —
/// the tool's enum is `SKILL_NAMES` rather than a list kept in step by hand,
/// and a skill written but never added below is a name the model is never
/// offered rather than a `notFound` at runtime.
///
/// All of §V.2's names are here — the thirty-seven occupations first, then the
/// ten foundations. Nothing anywhere else spells them out: §II.5's prose names
/// the two kinds and a couple of examples and points at the catalogue, which is
/// what a list this long makes the only affordable arrangement.

const REGISTERED = {
  "wedding-designer": weddingDesigner,
  "banner-designer": bannerDesigner,
  "album-designer": albumDesigner,
  "book-designer": bookDesigner,
  "editorial-designer": editorialDesigner,
  "poster-designer": posterDesigner,
  "packaging-designer": packagingDesigner,
  "presentation-designer": presentationDesigner,
  "logo-designer": logoDesigner,
  "brand-designer": brandDesigner,
  "art-director": artDirector,
  "lettering-artist": letteringArtist,
  printmaker,
  photographer,
  illustrator,
  "digital-artist": digitalArtist,
  "concept-artist": conceptArtist,
  "character-artist": characterArtist,
  "environment-artist": environmentArtist,
  "comic-artist": comicArtist,
  "storyboard-artist": storyboardArtist,
  animator,
  "motion-designer": motionDesigner,
  "3d-artist": threeDArtist,
  cinematographer,
  "production-designer": productionDesigner,
  "screen-designer": screenDesigner,
  "ux-designer": uxDesigner,
  "industrial-designer": industrialDesigner,
  architect,
  "interior-stylist": interiorStylist,
  "exhibition-designer": exhibitionDesigner,
  "fashion-stylist": fashionStylist,
  "textile-designer": textileDesigner,
  "collage-artist": collageArtist,
  "floral-designer": floralDesigner,
  "tattoo-artist": tattooArtist,
  "colour-theory": colourTheory,
  composition,
  typography,
  "visual-hierarchy": visualHierarchy,
  "light-and-shadow": lightAndShadow,
  "grid-systems": gridSystems,
  "depth-and-space": depthAndSpace,
  "style-and-period": styleAndPeriod,
  "texture-and-materials": textureAndMaterials,
  "type-and-image": typeAndImage,
} as const satisfies Record<string, Skill>;

export type SkillName = keyof typeof REGISTERED;

export const SKILLS: Record<SkillName, Skill> = REGISTERED;

/// Occupations before foundations, and within a kind the order they were
/// registered in — the order the catalogue is read in, so it is the order §V.2
/// argues for rather than the alphabet's.
export const SKILL_NAMES: SkillName[] = (Object.keys(REGISTERED) as SkillName[]).sort(
  (a, b) => kindRank(SKILLS[a].kind) - kindRank(SKILLS[b].kind),
);

function kindRank(kind: SkillKind): number {
  return kind === "occupation" ? 0 : 1;
}

/// The catalogue `get_skill`'s description carries (§IV.5), so that choosing a
/// skill costs a line rather than a round.
export function skillCatalogue(): string {
  return SKILL_NAMES.map((name) => `${name} — ${SKILLS[name].summary}`).join("\n");
}

export function skillNamed(name: string): Skill | undefined {
  return isSkillName(name) ? SKILLS[name] : undefined;
}

export function isSkillName(name: string): name is SkillName {
  return Object.hasOwn(REGISTERED, name);
}

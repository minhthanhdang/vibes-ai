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
import { colourGrading } from "@/server/skills/colour-grading/skill";
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
import { focalPoint } from "@/server/skills/focal-point/skill";
import { gridSystems } from "@/server/skills/grid-systems/skill";
import { illustrator } from "@/server/skills/illustrator/skill";
import { industrialDesigner } from "@/server/skills/industrial-designer/skill";
import { interiorStylist } from "@/server/skills/interior-stylist/skill";
import { letteringArtist } from "@/server/skills/lettering-artist/skill";
import { lightAndShadow } from "@/server/skills/light-and-shadow/skill";
import { logoDesigner } from "@/server/skills/logo-designer/skill";
import { motionDesigner } from "@/server/skills/motion-designer/skill";
import { myTaste } from "@/server/skills/my-taste/skill";
import { packagingDesigner } from "@/server/skills/packaging-designer/skill";
import { photographer } from "@/server/skills/photographer/skill";
import { posterDesigner } from "@/server/skills/poster-designer/skill";
import { presentationDesigner } from "@/server/skills/presentation-designer/skill";
import { printmaker } from "@/server/skills/printmaker/skill";
import { productionDesigner } from "@/server/skills/production-designer/skill";
import { screenDesigner } from "@/server/skills/screen-designer/skill";
import { shapeAndForm } from "@/server/skills/shape-and-form/skill";
import { storyboardArtist } from "@/server/skills/storyboard-artist/skill";
import { styleAndPeriod } from "@/server/skills/style-and-period/skill";
import { tattooArtist } from "@/server/skills/tattoo-artist/skill";
import { textileDesigner } from "@/server/skills/textile-designer/skill";
import { textureAndMaterials } from "@/server/skills/texture-and-materials/skill";
import { threeDArtist } from "@/server/skills/3d-artist/skill";
import { typeAndImage } from "@/server/skills/type-and-image/skill";
import { typeFacesDisplay } from "@/server/skills/type-faces-display/skill";
import { typeFacesText } from "@/server/skills/type-faces-text/skill";
import { typeFacesVoice } from "@/server/skills/type-faces-voice/skill";
import { typography } from "@/server/skills/typography/skill";
import { uxDesigner } from "@/server/skills/ux-designer/skill";
import { visualHierarchy } from "@/server/skills/visual-hierarchy/skill";
import { weddingDesigner } from "@/server/skills/wedding-designer/skill";

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
  "type-faces-display": typeFacesDisplay,
  "type-faces-text": typeFacesText,
  "type-faces-voice": typeFacesVoice,
  "colour-grading": colourGrading,
  "focal-point": focalPoint,
  "shape-and-form": shapeAndForm,
  "my-taste": myTaste,
} as const satisfies Record<string, Skill>;

export type SkillName = keyof typeof REGISTERED;

export const SKILLS: Record<SkillName, Skill> = REGISTERED;

export const SKILL_NAMES: SkillName[] = (Object.keys(REGISTERED) as SkillName[]).sort(
  (a, b) => kindRank(SKILLS[a].kind) - kindRank(SKILLS[b].kind),
);

function kindRank(kind: SkillKind): number {
  return kind === "occupation" ? 0 : 1;
}

export function skillCatalogue(): string {
  return SKILL_NAMES.map((name) => `${name} — ${SKILLS[name].summary}`).join("\n");
}

export function skillNamed(name: string): Skill | undefined {
  return isSkillName(name) ? SKILLS[name] : undefined;
}

export function isSkillName(name: string): name is SkillName {
  return Object.hasOwn(REGISTERED, name);
}

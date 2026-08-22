import "server-only";
import type { Skill, SkillKind } from "@/server/skills/skill";
import { albumDesigner } from "@/server/skills/album-designer/skill";
import { bannerDesigner } from "@/server/skills/banner-designer/skill";
import { colourTheory } from "@/server/skills/colour-theory/skill";
import { composition } from "@/server/skills/composition/skill";
import { conceptArtist } from "@/server/skills/concept-artist/skill";
import { digitalArtist } from "@/server/skills/digital-artist/skill";
import { environmentArtist } from "@/server/skills/environment-artist/skill";
import { gridSystems } from "@/server/skills/grid-systems/skill";
import { lightAndShadow } from "@/server/skills/light-and-shadow/skill";
import { photographer } from "@/server/skills/photographer/skill";
import { typography } from "@/server/skills/typography/skill";
import { visualHierarchy } from "@/server/skills/visual-hierarchy/skill";
import { weddingDesigner } from "@/server/skills/wedding-designer/skill";

/// The skill registry (compositor-v2.md §V.1).
///
/// Thirteen modules imported by name rather than a directory read, and that is
/// the point of the whole arrangement: a bundler can trace an import and cannot
/// trace a `readFileSync`, so a skill that works locally and 500s in production
/// is not a shape this can take. Being typed is the second half — the tool's
/// enum is `SKILL_NAMES` rather than a list kept in step by hand, and a skill
/// written but never added below is a name the model is never offered rather
/// than a `notFound` at runtime.
///
/// All thirteen §V.2 names are here — the seven occupations first, then the six
/// foundations. Nothing anywhere else spells the thirteen except §II.5's prose,
/// which the instruction's own test pins against this record: a skill in one and
/// not the other is either a name the model is told to ask for and is refused,
/// or a file nobody is ever told about.

const REGISTERED = {
  "wedding-designer": weddingDesigner,
  "banner-designer": bannerDesigner,
  "album-designer": albumDesigner,
  photographer,
  "digital-artist": digitalArtist,
  "concept-artist": conceptArtist,
  "environment-artist": environmentArtist,
  "colour-theory": colourTheory,
  composition,
  typography,
  "visual-hierarchy": visualHierarchy,
  "light-and-shadow": lightAndShadow,
  "grid-systems": gridSystems,
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

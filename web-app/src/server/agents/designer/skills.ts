import "server-only";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { getSkillsFor, SKILLS_ALREADY_READ_NOTE } from "@/lib/agent/designer/skill-tools";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import { SKILL_NAMES, skillCatalogue, skillNamed } from "@/server/skills";
import { skillExcerpt } from "@/server/skills/skill";

export const GET_SKILLS: ToolDeclaration = getSkillsFor({
  names: SKILL_NAMES,
  catalogue: skillCatalogue(),
});

export function skillStatusSaid(read: number): string {
  const skills = read === 1 ? "1 skill" : `${read} skills`;
  return `read — ${skills} so far in this design, and as many more as the work needs are still there for the asking. They stay in front of you for the rest of the work and are never dropped from what you can see, so there is nothing to ask for again. They are general craft rather than instructions: judge what you make against them, and do not read them back to the user.`;
}

export const SKILL_NOT_FOUND_NOTE =
  "there is no skill by that name — the list in get_skills' own description is the whole of what exists here, so nothing was read for it";

export const NO_SKILL_NAMED =
  "name at least one skill to read, by a name from the catalogue in this tool's description. Nothing was read, so ask again with a name on it.";

export type DesignerSkillToolset = {
  declarations: ToolDeclaration[];
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
  read: () => string[];
};

export function skillToolset(): DesignerSkillToolset {
  const read: string[] = [];

  function readSkills(args: Record<string, unknown>): Record<string, unknown> {
    const asked = namesIn(args.skills);
    if (!asked.length) return { error: NO_SKILL_NAMED };

    const alreadyRead = asked.filter((name) => read.includes(name));
    const wanted = asked.filter((name) => !read.includes(name));

    const skills: Record<string, unknown>[] = [];
    const notFound: string[] = [];
    for (const name of wanted) {
      const skill = skillNamed(name);
      if (!skill) {
        notFound.push(name);
        continue;
      }
      skills.push({
        name: skill.name,
        title: skill.title,
        kind: skill.kind,
        text: skillExcerpt(skill.text),
      });
    }

    read.push(...skills.map((skill) => skill.name as string));

    return {
      skills,
      ...(skills.length && { status: skillStatusSaid(read.length) }),
      ...(notFound.length && { notFound, notFoundNote: SKILL_NOT_FOUND_NOTE }),
      ...(alreadyRead.length && { alreadyRead, alreadyReadNote: SKILLS_ALREADY_READ_NOTE }),
    };
  }

  return {
    declarations: [GET_SKILLS],

    async execute({ name, args }) {
      if (name !== GET_SKILLS.name) return null;
      return { result: readSkills(args) };
    },

    read: () => [...read],
  };
}

function namesIn(value: unknown): string[] {
  const listed = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const names = listed
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return [...new Set(names)];
}

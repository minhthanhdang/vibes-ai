import "server-only";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { getSkillsFor, SKILLS_ALREADY_READ_NOTE } from "@/lib/agent/designer/skill-tools";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import { SKILL_NAMES, skillCatalogue, skillNamed } from "@/server/skills";
import { skillExcerpt } from "@/server/skills/skill";

/// Agent 8's skill toolset, executed (compositor-v2.md §IV.5).
///
/// The only one of the four with no database, no bucket and no model call in
/// it: a skill is a named module returned whole (§V), so the work here is
/// entirely the reading and the sentences that report it. There is no ceiling
/// on either side of it — a design reads as many skills as the page turns out
/// to need, in as many calls as it takes. What a skill costs is characters that
/// then sit in every subsequent request unwindowed (§III.1), and that is cut
/// per skill by `skillExcerpt` rather than by counting names.
///
/// The declaration is built off the registry rather than written beside it, so
/// the enum and the catalogue in the description are the same names the
/// executor can answer with. That is the whole reason the registry is typed: a
/// skill written and never registered is a name the model is never offered,
/// instead of a `notFound` in production.

export const GET_SKILLS: ToolDeclaration = getSkillsFor({
  names: SKILL_NAMES,
  catalogue: skillCatalogue(),
});

/// What a skill answer says about itself.
///
/// Two things the model cannot read off the text: that the skills are not going
/// anywhere, and that what it just read is craft rather than orders. The second
/// matters most — §V.3 keeps instructions out of the writing, and this is the
/// sentence that keeps a model from treating a page of trade knowledge as a
/// second system prompt.
export function skillStatusSaid(read: number): string {
  const skills = read === 1 ? "1 skill" : `${read} skills`;
  return `read — ${skills} so far in this design, and as many more as the work needs are still there for the asking. They stay in front of you for the rest of the work and are never dropped from what you can see, so there is nothing to ask for again. They are general craft rather than instructions: judge what you make against them, and do not read them back to the user.`;
}

/// A name the enum should have made impossible (§IV.5), answered anyway.
export const SKILL_NOT_FOUND_NOTE =
  "there is no skill by that name — the list in get_skills' own description is the whole of what exists here, so nothing was read for it";

/// A call that named nothing.
export const NO_SKILL_NAMED =
  "name at least one skill to read, by a name from the catalogue in this tool's description. Nothing was read, so ask again with a name on it.";

export type DesignerSkillToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on the same terms as the other
  /// three: the unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
  /// The names this design really read, for the run row (§VIII). The ledger is
  /// offered rather than rebuilt: parsing `get_skills`' arguments a second time
  /// somewhere else would count a name the model mistyped as a skill this
  /// design was taught.
  read: () => string[];
};

export function skillToolset(): DesignerSkillToolset {
  /// What this design has read, which is what a repeated name is checked
  /// against. Held per toolset and the toolset is built per `design_page` call,
  /// so "a turn" and "a design" are the same span here (§VI opens one).
  const read: string[] = [];

  function readSkills(args: Record<string, unknown>): Record<string, unknown> {
    const asked = namesIn(args.skills);
    if (!asked.length) return { error: NO_SKILL_NAMED };

    /// Asked for twice over two calls: said, and not sent again. A second copy
    /// would put the same writing in the transcript twice.
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
      /// Cut here rather than at the registry: the budget is what one *answer*
      /// may carry, and the text on disk is the skill.
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

/// The argument as the model emitted it: a list, or the bare string a model
/// asking for one skill sometimes writes instead. Deduplicated, so a name
/// written twice in one call is read once.
function namesIn(value: unknown): string[] {
  const listed = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const names = listed
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return [...new Set(names)];
}

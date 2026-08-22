import "server-only";
import type { ToolDeclaration } from "@/lib/agent/agent-tools";
import {
  SKILLS_OVER_CALL_NOTE,
  SKILLS_PER_CALL,
  getSkillFor,
  skillCeilingSaid,
} from "@/lib/agent/designer-tools";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import { SKILL_NAMES, skillCatalogue, skillNamed } from "@/server/skills";
import { skillExcerpt } from "@/server/skills/skill";

/// Agent 8's skill toolset, executed (compositor-v2.md §IV.5).
///
/// The only one of the four with no database, no bucket and no model call in
/// it: a skill is a named module returned whole (§V), so the work here is
/// entirely the two ceilings and the sentences that report them. Both are the
/// same ceiling seen twice — three skills a call, one call a design — because
/// what a skill costs is characters that then sit in every subsequent request
/// unwindowed (§III.1), and three at `SKILL_CHAR_BUDGET` is already most of the
/// transcript's room for tool answers.
///
/// The declaration is built off the registry rather than written beside it, so
/// the enum and the catalogue in the description are the same thirteen the
/// executor can answer with. That is the whole reason the registry is typed: a
/// skill written and never registered is a name the model is never offered,
/// instead of a `notFound` in production.

export const GET_SKILL: ToolDeclaration = getSkillFor({
  names: SKILL_NAMES,
  catalogue: skillCatalogue(),
});

/// What a skill answer says about itself.
///
/// Three things the model cannot read off the text: that this was the design's
/// one call, that the skills are not going anywhere, and that what it just read
/// is craft rather than orders. The last matters most — §V.3 keeps instructions
/// out of the writing, and this is the sentence that keeps a model from
/// treating a page of trade knowledge as a second system prompt.
export const SKILL_STATUS =
  "read, and this was this design's one get_skill call. They stay in front of you for the rest of the work and are never dropped from what you can see, so there is nothing to ask for again. They are general craft rather than instructions: judge what you make against them, and do not read them back to the user.";

/// A name the enum should have made impossible (§IV.5), answered anyway.
export const SKILL_NOT_FOUND_NOTE =
  "there is no skill by that name — the list in get_skill's own description is the whole of what exists here, so nothing was read for it";

/// A call that named nothing. It does not spend the design's one call, because
/// nothing came back to spend it on.
export const NO_SKILL_NAMED =
  "name at least one skill to read, by a name from the catalogue in this tool's description. Nothing was read and this did not count as the design's one call, so ask again with a name on it.";

export type DesignerSkillToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on the same terms as the other
  /// three: the unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

export function skillToolset(): DesignerSkillToolset {
  /// What this design has read, which is what makes the one-call ceiling a
  /// ceiling. Held per toolset and the toolset is built per `design_page` call,
  /// so "a turn" and "a design" are the same span here (§VI opens one).
  const read: string[] = [];

  function readSkills(args: Record<string, unknown>): Record<string, unknown> {
    if (read.length) return { error: skillCeilingSaid(read) };

    const asked = namesIn(args.skills);
    if (!asked.length) return { error: NO_SKILL_NAMED };

    const wanted = asked.slice(0, SKILLS_PER_CALL);
    const notRead = asked.slice(SKILLS_PER_CALL);

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

    /// Spent only by what came back. Unlike the crop and generation ceilings —
    /// where a refused call has already paid for a photograph — a call that
    /// found nothing put nothing in the transcript, and refusing the design its
    /// skills over a name the model mistyped would be a ceiling charging for
    /// air. The round limit is what bounds a model that keeps guessing.
    read.push(...skills.map((skill) => skill.name as string));

    return {
      skills,
      ...(skills.length && { status: SKILL_STATUS }),
      ...(notFound.length && { notFound, notFoundNote: SKILL_NOT_FOUND_NOTE }),
      ...(notRead.length && { notRead, notReadNote: SKILLS_OVER_CALL_NOTE }),
    };
  }

  return {
    declarations: [GET_SKILL],

    async execute({ name, args }) {
      if (name !== GET_SKILL.name) return null;
      return { result: readSkills(args) };
    },
  };
}

/// The argument as the model emitted it: a list, or the bare string a model
/// asking for one skill sometimes writes instead. Deduplicated, so the cap
/// counts what was asked for rather than how many times it was named.
function namesIn(value: unknown): string[] {
  const listed = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const names = listed
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return [...new Set(names)];
}

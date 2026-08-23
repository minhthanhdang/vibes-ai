import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

/// Agent 8's skill door — the one tool that reads nothing belonging to this
/// project.

/// Skills in one call. Two numbers rather than one because they bound two
/// different things.
export const SKILLS_PER_CALL = 8;

/// The whole of what one design may read, over any number of calls.
export const SKILLS_PER_DESIGN = 12;

/// The surplus, reported rather than dropped — and, unlike every other surplus
/// note in this file, with somewhere to go.
export function skillsOverCallSaid(remaining: number): string {
  return remaining > 0
    ? `only ${SKILLS_PER_CALL} skills are read in one call, so these were not read — ask for the ones still wanted in another call, ${remaining} more skills are allowed in this design`
    : `only ${SKILLS_PER_CALL} skills are read in one call, so these were not read, and this design's ${SKILLS_PER_DESIGN} skills are now spent — work from the ones above rather than naming these to the user`;
}

/// Names asked for a second time, answered with the fact rather than a second
/// copy.
export const SKILLS_ALREADY_READ_NOTE = `already read earlier in this design and still in front of you, so they were not sent again and did not count against the allowance — read them where they are`;

/// What a `get_skill` past the design's allowance is refused with. It names
/// what was read, because that is the refusal's real content.
export function skillCeilingSaid(read: readonly string[]): string {
  const named = read.join(", ");
  return `this design has read its ${SKILLS_PER_DESIGN} skills — ${named} — and that is the whole allowance. They are still above you and they stay there for the rest of the work, so read them again where they are and get on with the page.`;
}

/// `get_skill`, built off the registry it answers from.
export function getSkillFor({
  names,
  catalogue,
}: {
  names: readonly string[];
  catalogue: string;
}): ToolDeclaration {
  return {
    name: "get_skill",
    description: `Read written expertise before you lay anything out: how a trade actually works, what it makes, what conventions it keeps and where it usually goes wrong. Choose by the job — an occupation for the kind of thing being made, a foundation for the part of the craft the page turns on — and call this in your first round, because it is what the work is then judged against. At most ${SKILLS_PER_CALL} in one call and ${SKILLS_PER_DESIGN} in a design, over as many calls as wanted — so read what the page rests on now and come back for more when the work turns out to need them. What comes back stays in front of you for the rest of the design and is never dropped, so there is nothing to re-read and no reason to ask twice. A skill is general writing about design and knows nothing about this project: it will not name a picture, a board or a page you have, it asks nothing of you, and reading one changes nothing. The catalogue:\n${catalogue}`,
    parameters: {
      type: "OBJECT",
      properties: {
        skills: {
          type: "ARRAY",
          description: `Which to read, by name from the catalogue above, best first — anything past ${SKILLS_PER_CALL} is not read in this call and is named back, and a skill already read is not sent twice.`,
          items: { type: "STRING", enum: [...names] },
        },
      },
      required: ["skills"],
    },
  };
}

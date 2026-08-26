import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

export const SKILLS_ALREADY_READ_NOTE = `already read earlier in this design and still in front of you, so they were not sent again — read them where they are`;

export function getSkillsFor({
  names,
  catalogue,
}: {
  names: readonly string[];
  catalogue: string;
}): ToolDeclaration {
  return {
    name: "get_skills",
    description: `Read written expertise before you lay anything out: how a trade actually works, what it makes, what conventions it keeps and where it usually goes wrong. Choose by the job — an occupation for the kind of thing being made, a foundation for the part of the craft the page turns on — and call this in your first round, because it is what the work is then judged against. Ask for as many as the page rests on, in one call or over several, and come back for more when the work turns out to need them. What comes back stays in front of you for the rest of the design and is never dropped, so there is nothing to re-read and no reason to ask twice. A skill is general writing about design and knows nothing about this project: it will not name a picture, a board or a page you have, it asks nothing of you, and reading one changes nothing. The catalogue:\n${catalogue}`,
    parameters: {
      type: "OBJECT",
      properties: {
        skills: {
          type: "ARRAY",
          description: `Which to read, by name from the catalogue above, best first — a skill already read is not sent twice.`,
          items: { type: "STRING", enum: [...names] },
        },
      },
      required: ["skills"],
    },
  };
}

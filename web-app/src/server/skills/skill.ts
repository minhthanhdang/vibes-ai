import "server-only";

export type SkillKind = "occupation" | "foundation";

export type Skill = {
  name: string;
  kind: SkillKind;
  title: string;
  summary: string;
  text: string;
};

export const SKILL_CHAR_BUDGET = 6000;

export function skillCutSaid(kept: number, total: number): string {
  return `[Cut: ${kept} of ${total} paragraphs. This skill runs past ${SKILL_CHAR_BUDGET} characters and the rest is not in this answer.]`;
}

export function skillExcerpt(text: string): string {
  if (text.length <= SKILL_CHAR_BUDGET) return text;

  const paragraphs = text.split(/\n{2,}/);
  const room = SKILL_CHAR_BUDGET - skillCutSaid(paragraphs.length, paragraphs.length).length - 2;

  const kept: string[] = [];
  let used = 0;
  for (const paragraph of paragraphs) {
    const cost = kept.length ? paragraph.length + 2 : paragraph.length;
    if (used + cost > room) break;
    kept.push(paragraph);
    used += cost;
  }

  if (!kept.length) kept.push(cutAtWord(paragraphs[0], room));
  return `${kept.join("\n\n")}\n\n${skillCutSaid(kept.length, paragraphs.length)}`;
}

function cutAtWord(paragraph: string, room: number): string {
  const head = paragraph.slice(0, room);
  const space = head.lastIndexOf(" ");
  return space > 0 ? head.slice(0, space) : head;
}

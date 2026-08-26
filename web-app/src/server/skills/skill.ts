import "server-only";

/// What a skill is (compositor-v2.md §V).
///
/// A skill is text. No model call, no retrieval, no embedding — a named file
/// returned whole. This module is the shape every one of them fills in and the
/// one piece of arithmetic they share; the writing lives in
/// `src/server/skills/<name>/skill.ts` and `index.ts` is the registry.
///
/// The shape is here rather than in the registry so a skill file imports only
/// the shape. `index.ts` imports every skill; a skill importing `index.ts` back
/// for its type would put the whole registry at the head of one cycle — erased at
/// runtime, but a cycle a reader still has to hold.
///
/// The three rules a skill's text may not break (§V.3) are held in
/// `index.test.mts` against every registered skill rather than in this type: no
/// instructions to the agent, nothing about this project, no tool names. None
/// of them is a shape, all of them are what makes a skill the same file for
/// every project, and a rule that only review enforces is one a fortieth file
/// written in a hurry breaks.

export type SkillKind = "occupation" | "foundation";

export type Skill = {
  /// The tool's enum takes this, and it is the directory the file sits in.
  name: string;
  /// What the split is for (§V.2): an occupation says what a *trade* does, a
  /// foundation says what *design* does. A wedding skill that re-taught colour
  /// theory would be the same six paragraphs in seven files.
  kind: SkillKind;
  /// Human-readable, for the line an answer opens with.
  title: string;
  /// One line. `get_skills`' declaration carries the whole catalogue as these
  /// summaries, so choosing a skill costs no round (§IV.5).
  summary: string;
  text: string;
};

/// Per skill (§IV.5). A skill is a page of writing, not a book — and three of
/// them at this size are already most of the transcript's character budget,
/// which is why the loop pins them rather than letting the window choose.
export const SKILL_CHAR_BUDGET = 6000;

/// The cut, said out loud (§IV.5).
///
/// A skill silently ending two paragraphs early is a trade half-learnt with no
/// sign that it was: the model reads a paragraph on measure, never reaches the
/// one on leading, and has no way to tell that from a skill that had nothing to
/// say about leading.
export function skillCutSaid(kept: number, total: number): string {
  return `[Cut: ${kept} of ${total} paragraphs. This skill runs past ${SKILL_CHAR_BUDGET} characters and the rest is not in this answer.]`;
}

/// A skill's text under `SKILL_CHAR_BUDGET`, cut on a paragraph boundary.
///
/// Whole paragraphs, because a paragraph is the unit the writing was made in
/// and half of one is a sentence that stops. The note counts against the budget
/// rather than being added on top of it: a budget that the thing announcing the
/// cut is allowed to exceed is not one.
///
/// A first paragraph longer than the budget on its own has no boundary to cut
/// on, so it is cut at a word instead — the alternative is answering with the
/// note and nothing else, which tells the model less than a truncated paragraph
/// does.
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

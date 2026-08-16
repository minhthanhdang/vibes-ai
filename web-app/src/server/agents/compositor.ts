import "server-only";
import { MODELS, generateContent, textOf } from "@/server/google/vertex";
import { layoutBrief, type LayoutBlock, type MoodboardLayout } from "@/lib/moodboard-layouts";

/// Agent 4, the moodboard compositor (tech-spec §III.4). One call per board:
/// given the blocks, a resolved layout and what the director is after, it says
/// which block goes in which slot.
///
/// Assignment only. It never emits a coordinate, never sees a page, and is not
/// shown a single pixel — the slots arrive as a shape and a share of the page
/// (`layoutBrief`), the blocks as agent 2's tags, and what comes back is pairs
/// of ids. Deterministic code turns those into excalidraw elements against the
/// slot constants. Same division of labour as agent 3: the model emits
/// judgement, code emits pixels and coordinates.
///
/// That is also why this is the cheapest agent in the pipeline. The whole call
/// is text — no image parts, no bytes, no vision — so a board of nine
/// photographs costs about what one sentence of chat costs.
const SYSTEM_INSTRUCTION = `You are the moodboard compositor for a film director's reference assistant.

You are given a layout — a page with named slots — a set of blocks, and what the
director is chasing. Say which block goes in which slot.

- Every slot has a shape and a share of the page. The largest slots are what the
  board is *about*: put the image that carries the look there, and the ones that
  support it in the smaller slots.
- Slot ids are in reading order. img-1 is where the eye starts.
- Match shape to shape. A portrait photograph in a wide slot is a photograph with
  empty page either side of it.
- Put neighbours beside each other: two references sharing a palette, a light or
  a subject read as one idea when they touch and as a list when they do not.
- A text slot takes a text block and nothing else. An image slot takes an image
  block and nothing else.
- You do not have to place every block. A board is a selection — leave out what
  does not belong on this one rather than filling a slot for the sake of it.
- Do not name a slot twice or a block twice.

Answer with the assignment and one short line — a sentence at most — saying what
you put where and why, in the language used on set. That line is read out to the
director, so it names photographs by what they are, not by their ids.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    assignments: {
      type: "ARRAY",
      description: "Which block occupies which slot, in reading order.",
      items: {
        type: "OBJECT",
        properties: {
          blockId: { type: "STRING" },
          slotId: { type: "STRING" },
        },
        required: ["blockId", "slotId"],
        propertyOrdering: ["blockId", "slotId"],
      },
    },
    note: { type: "STRING", description: "One line on what was placed and why." },
  },
  required: ["assignments", "note"],
  propertyOrdering: ["assignments", "note"],
};

/// One block as the compositor reads it. The id is what comes back in the
/// assignment; for an image that is the reference id, which is what lets a cut
/// and the photograph it was cut from be offered on equal terms.
///
/// Deliberately the same fields `referenceDigest` produces, plus the kind: the
/// catalog the orchestrator already read is the brief this agent works from, so
/// a board is composed out of what the director was just shown rather than out
/// of a second, differently-worded description of the same pictures.
export type BlockBrief = {
  id: string;
  kind: "image" | "text";
  shape?: string;
  keeps?: string;
  tags?: string[];
  /// The words, for a text block.
  text?: string;
};

export type CompositorResult = {
  model: string;
  assignments: { blockId: string; slotId: string }[];
  note: string;
};

/// What the compositor could not answer, as opposed to what went wrong reaching
/// it. The caller records this on the run row, exactly as agent 3's does.
export class CompositorError extends Error {}

export function blockBrief(block: LayoutBlock & { shape?: string; keeps?: string; tags?: string[] }): BlockBrief {
  return {
    id: block.id,
    kind: block.kind,
    ...(block.shape && { shape: block.shape }),
    ...(block.keeps && { keeps: block.keeps }),
    ...(block.tags?.length && { tags: block.tags }),
    ...(block.kind === "text" && block.text ? { text: block.text } : {}),
  };
}

export async function composeMoodboard({
  layout,
  blocks,
  intention,
}: {
  /// Already resolved — `RANDOM` is settled by `resolveLayout` before the call,
  /// so the model is never asked to choose a template and assign to it in the
  /// same breath.
  layout: MoodboardLayout;
  blocks: readonly BlockBrief[];
  intention: string;
}): Promise<CompositorResult> {
  if (blocks.length === 0) throw new CompositorError("there are no blocks to put on a board");

  const asked = intention.trim();
  const request = [
    `Layout: ${JSON.stringify(layoutBrief(layout))}`,
    `Blocks: ${JSON.stringify(blocks)}`,
    asked ? `The director is after: ${asked}` : "The director gave no brief — compose on the tags alone.",
  ].join("\n\n");

  const response = await generateContent(
    MODELS.PRO,
    [{ role: "user", parts: [{ text: request }] }],
    {
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        /// An assignment is a reading of the set, not a creative act. Two runs
        /// over the same blocks drifting apart would be two different boards
        /// filed under one intention.
        temperature: 0.2,
      },
    },
  );

  const answer = parse(textOf(response.candidates?.[0]?.content?.parts ?? []));
  const assignments = assignmentsOf(answer.assignments);
  /// Nothing placeable at all. Told as a refusal rather than materialized as an
  /// empty board: a page of slots with no photographs in it is not a moodboard,
  /// and the director asked for one.
  if (assignments.length === 0) {
    throw new CompositorError("the compositor placed nothing on the board");
  }

  return {
    model: MODELS.PRO,
    assignments,
    note: typeof answer.note === "string" ? answer.note.trim() : "",
  };
}

/// Structured output makes this JSON, but a safety block or a truncated response
/// comes back as prose in the same field — the same two failures agents 2 and 3
/// tell apart, and for the same reason: the message lands on the run row.
function parse(text: string) {
  if (!text) throw new CompositorError("compositor returned no content");
  try {
    return JSON.parse(text) as { assignments?: unknown; note?: unknown };
  } catch {
    throw new CompositorError(`compositor returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/// The pairs, as whatever the model emitted. Malformed entries are dropped here
/// rather than crashing the board — what survives is held against the layout by
/// `planAssignments`, which is the thing that reports what did not stick.
export function assignmentsOf(value: unknown): { blockId: string; slotId: string }[] {
  if (!Array.isArray(value)) return [];

  const pairs: { blockId: string; slotId: string }[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { blockId, slotId } = entry as Record<string, unknown>;
    if (typeof blockId !== "string" || typeof slotId !== "string") continue;
    const pair = { blockId: blockId.trim(), slotId: slotId.trim() };
    if (!pair.blockId || !pair.slotId) continue;
    pairs.push(pair);
  }
  return pairs;
}

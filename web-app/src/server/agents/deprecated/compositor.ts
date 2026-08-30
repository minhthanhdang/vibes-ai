import "server-only";
import { MODELS, generateContent, textOf } from "@/server/google/vertex";
import { layoutBrief, type LayoutBlock, type MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";

const SYSTEM_INSTRUCTION = `You are the moodboard compositor for a moodboard assistant for creatives.

You are given a layout — a page with named slots — a set of blocks, and what the
user is chasing. Say which block goes in which slot.

- Every slot has a shape and a share of the page. The largest slots are what the
  board is *about*: put the image that carries the look there, and the ones that
  support it in the smaller slots.
- A block marked \`favorite\` is one the user starred themselves. That is their
  judgement of the set and it outranks anything you read in the tags: give it the
  largest slot that suits its shape, and never be the one to leave it off.
- Slot ids are in reading order. img-1 is where the eye starts.
- Match shape to shape. A portrait photograph in a wide slot is a photograph with
  empty page either side of it.
- Put neighbours beside each other: two references sharing a palette, a light or
  a subject read as one idea when they touch and as a list when they do not.
- A text slot takes a text block and nothing else. An image slot takes an image
  block and nothing else.
- Place every block you are given while there is a free slot of its kind. The
  blocks are the user's own selection and a picture left off is a picture
  taken off their board — a photograph whose shape suits the slot poorly still
  belongs on the board, with page showing around it, and is cropped later. Leave
  a block out only when the blocks of its kind outnumber the slots, and then
  leave out the ones that do least for the look.
- Do not name a slot twice or a block twice.
- Sometimes the board already exists and most of it is staying as it is. Then you
  are given what is already in place and only the slots that are still free: say
  where the new blocks go among those. The pictures already on the board do not
  move, so do not name their slots — put the new ones where they sit best beside
  what is already there.
- A \`page\` tells you the board holds more than this one and which of them you are
  laying out. The other pages are not yours: nothing on them moves, nothing goes
  onto them, and no block belongs on one because it would sit better there.
  \`fresh\` means the page is one the board did not have — it is empty, so the
  blocks you are given are the whole of what will be on it and none of them can be
  left to a picture already in place.

Answer with the assignment and one short line — a sentence at most — saying what
you put where and why, speaking plainly about the pictures. That line is read out
to the user, so it names photographs by what they are, not by their ids — and when
you were given a page it says what happened on that page, by the name the user
knows it as, rather than talking about the board.`;

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

export type BlockBrief = {
  id: string;
  kind: "image" | "text";
  shape?: string;
  keeps?: string;
  tags?: string[];
  favorite?: true;
  text?: string;
};

export type PageBrief = {
  name?: string;
  page: string;
  board?: string;
  fresh?: true;
};

export function pageBrief({
  name,
  ordinal,
  of,
  board,
  fresh,
}: {
  name?: string;
  ordinal: number;
  of: number;
  board?: string;
  fresh?: boolean;
}): PageBrief {
  return {
    ...(name?.trim() && { name: name.trim() }),
    page: `${ordinal} of ${of}`,
    ...(board?.trim() && { board: board.trim() }),
    ...(fresh && { fresh: true as const }),
  };
}

export type CompositorResult = {
  model: string;
  assignments: { blockId: string; slotId: string }[];
  note: string;
  usage: TokenUsage;
};

export class CompositorError extends Error {}

export function blockBrief(
  block: LayoutBlock & { shape?: string; keeps?: string; tags?: string[]; favorite?: boolean },
): BlockBrief {
  return {
    id: block.id,
    kind: block.kind,
    ...(block.shape && { shape: block.shape }),
    ...(block.keeps && { keeps: block.keeps }),
    ...(block.tags?.length && { tags: block.tags }),
    ...(block.favorite && { favorite: true as const }),
    ...(block.kind === "text" && block.text ? { text: block.text } : {}),
  };
}

export async function composeMoodboard({
  layout,
  blocks,
  intention,
  inPlace = [],
  page,
  generate = generateContent,
}: {
  layout: MoodboardLayout;
  blocks: readonly BlockBrief[];
  intention: string;
  inPlace?: readonly (BlockBrief & { slotId: string })[];
  page?: PageBrief;
  generate?: typeof generateContent;
}): Promise<CompositorResult> {
  if (blocks.length === 0) throw new CompositorError("there are no blocks to put on a board");

  const asked = intention.trim();
  const request = [
    `Layout: ${JSON.stringify(layoutBrief(layout))}`,
    ...(page ? [`Page: ${JSON.stringify(page)}`] : []),
    ...(inPlace.length
      ? [`Already on the board and staying where they are: ${JSON.stringify(inPlace)}`]
      : []),
    `Blocks${inPlace.length ? " to place in the free slots" : ""}: ${JSON.stringify(blocks)}`,
    asked ? `The user is after: ${asked}` : "The user gave no brief — compose on the tags alone.",
  ].join("\n\n");

  const response = await generate(
    MODELS.FLASH,
    [{ role: "user", parts: [{ text: request }] }],
    {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  );

  const answer = parse(textOf(response.candidates?.[0]?.content?.parts ?? []));
  const assignments = assignmentsOf(answer.assignments);
  if (assignments.length === 0) {
    throw new CompositorError("the compositor placed nothing on the board");
  }

  return {
    model: MODELS.FLASH,
    assignments,
    note: typeof answer.note === "string" ? answer.note.trim() : "",
    usage: usageOf(response),
  };
}

function parse(text: string) {
  if (!text) throw new CompositorError("compositor returned no content");
  try {
    return JSON.parse(text) as { assignments?: unknown; note?: unknown };
  } catch {
    throw new CompositorError(`compositor returned non-JSON: ${text.slice(0, 200)}`);
  }
}

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

import "server-only";
import { MODELS, generateContent, textOf } from "@/server/google/vertex";
import { layoutBrief, type LayoutBlock, type MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { usageOf, type TokenUsage } from "@/lib/agent/model-cost";

/// Agent 4, the moodboard compositor (tech-spec §III.4). One call per board:
/// given the blocks, a resolved layout and what the user is after, it says
/// which block goes in which slot.
///
/// Assignment only. It never emits a coordinate and is not shown a single pixel
/// — the slots arrive as a shape and a share of the page (`layoutBrief`), the
/// blocks as agent 2's tags, and what comes back is pairs of ids. Deterministic
/// code turns those into excalidraw elements against the slot constants. Same
/// division of labour as agent 3: the model emits judgement, code emits pixels
/// and coordinates.
///
/// What it does compose is one *page* (§V), not a board: a board holds several
/// and the others are neither read to it nor its to change. Which page that is
/// arrives as `page` — where the geometry of it does not, because where a page
/// sits and what it is called were never the compositor's to decide.
///
/// That is also why this is the cheapest agent in the pipeline. The whole call
/// is text — no image parts, no bytes, no vision — so a board of nine
/// photographs costs about what one sentence of chat costs.
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

/// One block as the compositor reads it. The id is what comes back in the
/// assignment; for an image that is the reference id, which is what lets a cut
/// and the photograph it was cut from be offered on equal terms.
///
/// Deliberately the same fields `referenceDigest` produces, plus the kind: the
/// catalog the orchestrator already read is the brief this agent works from, so
/// a board is composed out of what the user was just shown rather than out
/// of a second, differently-worded description of the same pictures.
export type BlockBrief = {
  id: string;
  kind: "image" | "text";
  shape?: string;
  keeps?: string;
  tags?: string[];
  /// The user starred this one in the gallery. Present or absent, never
  /// false — and it is the only field here that is not a reading of the picture,
  /// which is exactly why it outranks the others when a slot has to be decided.
  favorite?: true;
  /// The words, for a text block.
  text?: string;
};

/// The page being composed, as the compositor reads it (§V). Only what changes
/// the assignment or the line the user hears: which page of which board it
/// is, and whether there is anything on it. Not its corner, not its id, not its
/// size — the size is already the layout's page, and the rest is geometry the
/// model has no say in.
export type PageBrief = {
  /// Absent on a page nobody has named — the model is then left with "page 2 of
  /// 3", which is what the user would call it too.
  name?: string;
  /// "2 of 3", in reading order — the same numbering `inspect_board` reports, so
  /// a page the user was told about is the page named back to them.
  page: string;
  board?: string;
  /// A page the board did not have until this call: empty, with nothing on it to
  /// keep and nothing being written over.
  fresh?: true;
};

/// Built here rather than in the caller so the wording the model reads is the
/// agent's own, on the same terms as `blockBrief`.
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
  /// One call, so one response's worth. Recorded anyway: "the cheapest agent in
  /// the pipeline" is a claim about a bill, and a claim about a bill that nobody
  /// is measuring is how a block cap gets quietly raised.
  usage: TokenUsage;
};

/// What the compositor could not answer, as opposed to what went wrong reaching
/// it. The caller records this on the run row, exactly as agent 3's does.
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
}: {
  /// Already resolved — `RANDOM` is settled by `resolveLayout` before the call,
  /// so the model is never asked to choose a template and assign to it in the
  /// same breath. On an edit to a board that already stands, the slots on it are
  /// only the *free* ones: the rest are taken and are not open to assignment.
  layout: MoodboardLayout;
  blocks: readonly BlockBrief[];
  intention: string;
  /// What is already on the board and staying there, slot by slot. Empty for a
  /// new board and for a rebuild that lays the whole thing out again. It is here
  /// for adjacency and for nothing else — "put neighbours beside each other" is
  /// unanswerable about a half-full board whose other half is invisible.
  inPlace?: readonly (BlockBrief & { slotId: string })[];
  /// Sent only when it tells the model something it cannot read off the layout:
  /// a board holding one page is the board, so an ordinary compose and an
  /// ordinary rebuild are the same prompt they have always been.
  page?: PageBrief;
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

  const response = await generateContent(
    MODELS.FLASH,
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
  /// and the user asked for one.
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

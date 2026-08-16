import { ANALYSIS_DIMENSIONS, tagLabel, type AnalysisProperties } from "./analysis";
import { CROP_ASPECTS, referenceCaption, type CropAspectId } from "./reference-version";
import {
  LAYOUT_MAX_BLOCKS,
  LAYOUT_MIN_BLOCKS,
  LAYOUT_REQUESTS,
  layoutLabel,
  type LayoutId,
} from "./moodboard-layouts";
import { COMPOSE_BLOCK_LIMIT } from "./moodboard-compose";

/// The contract between the agents and everything they are allowed to touch.
///
/// tech-spec §III gives every agent below the orchestrator a narrow, declared
/// input and no way to wander outside it, so the tools here are deliberately not
/// "the database, exposed". They are the two questions an agent tier can ask
/// about a project's pictures — what is in it, and put these in front of the
/// director — plus the shape an answer comes back in.
///
/// Kept pure and out of `server/` because both sides need it: the executor
/// builds these values, the chat renders them, and a tool whose answer the UI
/// cannot draw is a tool the director never sees the result of.

/// The function-calling shape Vertex takes. Declared structurally rather than
/// imported from `server/google/vertex`, which is `server-only` — this module is
/// also loaded in the browser to render what a tool answered.
export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/// How many references one catalog answer carries. Every row in it is tokens on
/// every subsequent turn of the conversation, so this is a cost ceiling first
/// and a readability one second: a director with two hundred uploads gets the
/// most recent slice and a count of the rest, not the whole gallery inlined into
/// the context window.
export const CATALOG_LIMIT = 24;

/// How many references one `show_references` call may put in the chat. A reply
/// carrying more pictures than a director can look at is a reply they scroll
/// past.
export const SHOWN_LIMIT = 8;

export const LIST_REFERENCES: ToolDeclaration = {
  name: "list_references",
  description:
    "List the pictures in this project — the director's uploads and, optionally, the crops made of them. Returns each one's id, title, shape and the properties agent 2 read off it. Call this before naming any reference: ids are the only way to point at a picture.",
  parameters: {
    type: "OBJECT",
    properties: {
      includeCrops: {
        type: "BOOLEAN",
        description:
          "Include the crops cut out of the uploads. False by default — the gallery is the photographs.",
      },
    },
  },
};

export const SHOW_REFERENCES: ToolDeclaration = {
  name: "show_references",
  description:
    `Put pictures in front of the director, in the chat, beside your reply. Use it whenever you talk about specific references — a name in prose is not a picture. At most ${SHOWN_LIMIT} at a time, in the order they should be read.`,
  parameters: {
    type: "OBJECT",
    properties: {
      referenceIds: {
        type: "ARRAY",
        description: "Reference ids from list_references, in reading order.",
        items: { type: "STRING" },
      },
    },
    required: ["referenceIds"],
  },
};

export const COMPOSE_MOODBOARD: ToolDeclaration = {
  name: "compose_moodboard",
  description:
    `Lay the project's pictures out as a moodboard and file it as a new board the director can open and keep working on. This is the one tool that makes something rather than reads something, so call it when a board is asked for and not to illustrate a point — show_references is for that. Offer between ${LAYOUT_MIN_BLOCKS} and ${COMPOSE_BLOCK_LIMIT} references and expect a selection: past ${LAYOUT_MAX_BLOCKS} the surplus is left off the board.`,
  parameters: {
    type: "OBJECT",
    properties: {
      intention: {
        type: "STRING",
        description:
          "What this board is for, in the director's own words — the look it argues for. Used to compose it and, unless you give a title, to name it.",
      },
      referenceIds: {
        type: "ARRAY",
        description:
          "Reference ids from list_references, best first. Crops count: a cut framed for a shape is often the one that belongs on a board.",
        items: { type: "STRING" },
      },
      captions: {
        type: "ARRAY",
        description:
          "Lines to set on the board — a title, a note. Several layouts have a text block and leave it empty without one.",
        items: { type: "STRING" },
      },
      layout: {
        type: "STRING",
        description:
          "A template by name, or RANDOM to have one chosen by how many blocks are on offer. Leave it out unless the director asked for a particular shape of board.",
        enum: [...LAYOUT_REQUESTS],
      },
      title: {
        type: "STRING",
        description: "What to call the board. Defaults to the intention.",
      },
    },
    required: ["intention", "referenceIds"],
  },
};

/// A reference as the database holds it, in the columns a tool needs. Written as
/// the loosest shape that answers the questions below so the executor can hand
/// over a `forDisplay` row untouched.
export type ToolReference = {
  id: string;
  title: string;
  width?: number | null;
  height?: number | null;
  editIntent?: string | null;
  editAspect?: string | null;
  thumbUrl: string;
  source?: { id: string; title: string } | null;
  analysis?: Partial<AnalysisProperties> | null;
};

/// One reference as the model reads it. Every field earns its tokens: the id is
/// how the model points back at it, the shape is what decides whether a crop is
/// even possible at a format, and the tags are the vocabulary the whole pipeline
/// talks in. The bytes are never in here — an agent that needs to *look* at a
/// picture is given its `gs://` uri as a file part, not a JSON field.
export type ReferenceDigest = {
  id: string;
  title: string;
  shape: string;
  croppedFrom?: string;
  keeps?: string;
  tags?: string[];
};

/// The shape of a picture, by the name a director would use for it, falling back
/// to the ratio itself. A row uploaded before the dimension columns existed has
/// no shape at all, and saying so is better than inventing a square.
export function aspectLabel(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";

  const ratio = width / height;
  const named = (Object.keys(CROP_ASPECTS) as CropAspectId[]).find(
    (id) => Math.abs(ratio - CROP_ASPECTS[id]) / CROP_ASPECTS[id] <= ASPECT_TOLERANCE,
  );
  return named ?? `${ratio.toFixed(2)}:1`;
}

/// Close enough that a director would call it that format. A 5568×3712 photo is
/// 1.50 and nobody calls it 4:3, so this is tight rather than generous.
const ASPECT_TOLERANCE = 0.02;

/// The tags of one reference, flattened across the dimensions into the one list
/// the model reasons over. The palette is deliberately left out: six hex codes
/// per reference is a quarter of the catalog's tokens spent on something a model
/// cannot see anyway.
export function digestTags(analysis?: Partial<AnalysisProperties> | null) {
  if (!analysis) return undefined;
  const tags = ANALYSIS_DIMENSIONS.flatMap(({ key }) => analysis[key] ?? []).map(tagLabel);
  return tags.length ? tags : undefined;
}

export function referenceDigest(reference: ToolReference): ReferenceDigest {
  const keeps = (reference.editIntent ?? "").trim();
  const tags = digestTags(reference.analysis);
  return {
    id: reference.id,
    title: reference.title.trim() || "Untitled",
    shape: aspectLabel(reference.width, reference.height),
    ...(reference.source && { croppedFrom: reference.source.id }),
    ...(keeps && { keeps }),
    ...(tags && { tags }),
  };
}

/// The catalog answer: what fits, and how much did not. The count is the half a
/// truncated list cannot say for itself — a model that reads twenty-four rows
/// and answers "you have twenty-four references" is lying on our behalf.
export function referenceCatalog(references: readonly ToolReference[], limit = CATALOG_LIMIT) {
  const shown = references.slice(0, Math.max(0, limit));
  return {
    total: references.length,
    shown: shown.length,
    references: shown.map(referenceDigest),
  };
}

/// A picture rendered in the chat beside the reply, and clickable.
///
/// tech-spec §IV: a result the director cannot open is a result they have to go
/// find again by hand. So an attachment carries what it takes to draw it *and*
/// what it takes to walk to it — for a crop that is the frame it came out of,
/// because the crop's properties live under that frame and nowhere else.
export type ReferenceAttachment = {
  kind: "reference";
  referenceId: string;
  /// The frame this is a cut of, or null when it is a photograph in its own
  /// right. This is the row the properties panel opens on.
  frameId: string | null;
  title: string;
  caption: string;
  thumbUrl: string;
};

/// A board the assistant composed, in the chat. Same two halves as a reference's
/// — something to look at, and the id it takes to get there — because a board
/// the director has to go and find in the tab row is a board they compose again
/// by hand.
export type BoardAttachment = {
  kind: "board";
  boardId: string;
  title: string;
  caption: string;
  /// A board's own picture is drawn by the tab showing it, so a board that has
  /// never been opened does not have one. Until then the cover is the photograph
  /// the compositor put in the opening slot — which is the picture the board is
  /// about, and the one thing about it that is true before it is drawn.
  thumbUrl: string | null;
};

export type ChatAttachment = ReferenceAttachment | BoardAttachment;

/// What makes two attachments the same attachment. A model that lists a board
/// and then talks about it has answered once.
export function attachmentKey(attachment: ChatAttachment) {
  return attachment.kind === "board"
    ? `board:${attachment.boardId}`
    : `reference:${attachment.referenceId}`;
}

export function attachmentOf(reference: ToolReference): ReferenceAttachment {
  return {
    kind: "reference",
    referenceId: reference.id,
    frameId: reference.source?.id ?? null,
    title: reference.title.trim() || "Untitled",
    caption: referenceCaption(reference),
    thumbUrl: reference.thumbUrl,
  };
}

/// A composed board, as the chat draws it. The caption is what the board *is* —
/// how many photographs and in what shape — rather than what it is called, which
/// is already on the tile.
export function boardAttachmentOf({
  id,
  title,
  layout,
  images,
  thumbUrl,
}: {
  id: string;
  title: string;
  layout: LayoutId;
  images: number;
  thumbUrl: string | null;
}): BoardAttachment {
  return {
    kind: "board",
    boardId: id,
    title: title.trim() || "Untitled board",
    caption: `${images} ${images === 1 ? "photograph" : "photographs"} · ${layoutLabel(layout)}`,
    thumbUrl,
  };
}

/// What a tool answers with: the JSON the model reads back, and the pictures the
/// director sees. They are separate because they are for different readers — the
/// model gets ids and tags, the chat gets thumbnails, and neither is served by
/// being handed the other's half.
export type ToolOutcome = {
  result: Record<string, unknown>;
  attachments?: ChatAttachment[];
};

/// Where a click on an attachment lands. The workspace holds which half of the
/// page is showing and the properties panel is opened by id, so a target is
/// those two facts and nothing else — the chat does not need to know how either
/// is done.
export type AttachmentTarget =
  | {
      view: "gallery";
      /// The reference whose properties open. A cut opens the frame it came
      /// from: a cut's properties are a step *inside* that panel — the versions
      /// list under the frame — and the panel has no way in at a cut from
      /// outside.
      inspectId: string;
    }
  /// A board opens as a board: the composed scene is the thing to look at, and
  /// the tab row is where it is then renamed, duplicated or thrown away.
  | { view: "moodboard"; boardId: string };

export function attachmentTarget(attachment: ChatAttachment): AttachmentTarget {
  if (attachment.kind === "board") return { view: "moodboard", boardId: attachment.boardId };
  return { view: "gallery", inspectId: attachment.frameId ?? attachment.referenceId };
}

/// The references a `show_references` call named, in the order it named them,
/// and the ids that answered to nothing.
///
/// Unknown ids are reported rather than dropped: a model pointing at a reference
/// that is not in this project has misread the catalog, and it can only correct
/// itself on the next turn if it is told which id failed.
export function pickReferences(
  references: readonly ToolReference[],
  ids: readonly string[],
  /// How many survive. A strip in the chat and a set of blocks for a board are
  /// two different amounts of "too many", so the caller says which it is.
  limit = SHOWN_LIMIT,
) {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const seen = new Set<string>();
  const found: ToolReference[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const reference = byId.get(id);
    if (reference) found.push(reference);
    else missing.push(id);
  }

  return { found: found.slice(0, Math.max(0, limit)), missing };
}

/// One conversation's attachments, in arrival order, each picture once. A model
/// that shows the same reference on two turns of one exchange means it twice;
/// the chat only has room to draw it once.
export function mergedAttachments(
  current: readonly ChatAttachment[],
  added: readonly ChatAttachment[],
) {
  const seen = new Set(current.map(attachmentKey));
  const merged = [...current];

  for (const attachment of added) {
    const key = attachmentKey(attachment);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(attachment);
  }

  return merged;
}

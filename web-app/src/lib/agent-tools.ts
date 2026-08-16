import { ANALYSIS_DIMENSIONS, tagLabel, type AnalysisProperties } from "./analysis";
import {
  CROP_ASPECTS,
  CROP_ASPECT_IDS,
  referenceCaption,
  type CropAspectId,
} from "./reference-version";
import {
  cropOfferCaption,
  cropOfferTitle,
  cropPreview,
  type CropOffer,
  type CropPreview,
} from "./crop-offer";
import type { BoardPreview } from "./board-preview";
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
    "List the pictures in this project, with the crops made of them. The photographs are already in front of you — they are primed into your instructions and read fresh for this message — so this is for the cuts, which are not. Returns each one's id, title, shape and the properties agent 2 read off it.",
  parameters: {
    type: "OBJECT",
    properties: {
      includeCrops: {
        type: "BOOLEAN",
        description:
          "Include the crops cut out of the uploads. True is the only reason to call this at all; false answers with the photographs you already have.",
      },
    },
  },
};

/// The project's photographs, written into the turn instead of fetched by a tool
/// call.
///
/// Measured (iteration 10): the routing is ~75% of a turn's bill, because the
/// system instruction demanded `list_references` before any claim about the
/// project — so *every* turn was at least two rounds and every round re-sent the
/// instruction and all four tool declarations. A round costs more than this list
/// does: twenty-four of these lines is a few hundred tokens against a round's
/// couple of thousand. So the catalog is primed and the tool stays for what
/// priming cannot carry — the crops.
///
/// Lines rather than JSON for the same reason the palette was dropped: braces,
/// quotes and repeated keys are a third of the tokens of a catalog and none of
/// its content.
export function catalogBrief(
  references: readonly ToolReference[],
  {
    /// How many cuts exist under these photographs. A count rather than the
    /// rows: it is what tells the model whether `list_references` is worth a
    /// round, and a project with no crops should never spend one finding out.
    crops = 0,
    limit = CATALOG_LIMIT,
  }: { crops?: number; limit?: number } = {},
) {
  const { total, shown, references: digests } = referenceCatalog(references, limit);
  const cuts = crops ? ` ${crops} ${crops === 1 ? "cut has" : "cuts have"} been made of them.` : "";

  if (!total) {
    return `This project has no pictures in it yet — nothing has been uploaded.${cuts}`;
  }

  const head =
    shown < total
      ? `The project holds ${total} photographs. The ${shown} most recent:${cuts}`
      : `The project holds ${total} ${total === 1 ? "photograph" : "photographs"}:${cuts}`;

  return [head, ...digests.map(digestLine)].join("\n");
}

/// One reference on one line, in the order a director reads it: what to call it
/// by, what it is called, what shape it is, and what it is of.
function digestLine({ id, title, shape, keeps, tags }: ReferenceDigest) {
  return [id, title, shape, keeps, tags?.join(", ")].filter(Boolean).join(" · ");
}

/// How many boards one brief names. A board is one short line and a director
/// works on one or two at a time, so this is a truncation that should almost
/// never bite — it is here for the project that has been open for a week.
export const BOARDS_BRIEF_LIMIT = 6;

/// A board as the model reads it: the id it is rebuilt by, what it is called and
/// what size page it was laid out on. Not what is *on* it — the elements of a
/// board are up to two megabytes of JSON each, and reading every board's scene on
/// every message to count photographs would be the most expensive thing in a turn
/// that never mentions a board.
export type BoardDigest = {
  id: string;
  title: string;
  width: number;
  height: number;
  /// The template it was composed at, absent for a board dragged together by
  /// hand. Worth the three tokens a line: without it the model asking for a
  /// change to a board cannot tell whether the shape it is about to describe is
  /// the shape the board already has.
  layout?: string | null;
};

/// The project's boards, primed into the turn on the same terms as its
/// photographs.
///
/// Without this the orchestrator cannot name a board at all: there is no
/// `list_boards`, and a fifth tool declaration would be tokens on every round of
/// every turn to answer a question three lines of instruction answer for free.
/// It is also the half of `compose_moodboard` that makes rebuilding possible —
/// an id the model was never given is an id it cannot pass.
export function boardsBrief(boards: readonly BoardDigest[], limit = BOARDS_BRIEF_LIMIT) {
  const shown = boards.slice(0, Math.max(0, limit));
  if (!shown.length) return "";

  const head =
    shown.length < boards.length
      ? `The project holds ${boards.length} boards. The ${shown.length} most recently worked on:`
      : `The project holds ${boards.length} ${boards.length === 1 ? "board" : "boards"}:`;

  return [head, ...shown.map(boardLine)].join("\n");
}

function boardLine({ id, title, width, height, layout }: BoardDigest) {
  return [id, title.trim() || "Untitled board", `${width}×${height}`, layout]
    .filter(Boolean)
    .join(" · ");
}

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

/// How many cuts one turn of the conversation may ask for.
///
/// Every other tool here is a database read; this one is a vision call on a
/// photograph, which is the most expensive thing this app does. A model that
/// answers "crop them all for the board" with eight of them has spent the
/// afternoon's budget on boxes nobody has looked at yet — and the director can
/// only read so many offers at once anyway.
export const CROP_CALL_LIMIT = 2;

export const CROP_REFERENCE: ToolDeclaration = {
  name: "crop_reference",
  description:
    `Ask the cropper for the part of one reference that is the shot the director described. It does not change anything: what comes back is an offer drawn on the frame, which the director accepts or declines in the reference's properties panel. One reference per call and at most ${CROP_CALL_LIMIT} a turn — reading a photograph is the most expensive thing you can ask for, so crop when a cut is asked for and pick the one frame it is about.`,
  parameters: {
    type: "OBJECT",
    properties: {
      referenceId: {
        type: "STRING",
        description: "The reference to cut, by an id from list_references.",
      },
      intention: {
        type: "STRING",
        description:
          "What the director wants out of the frame, in their own words — the subject, the part of it, the shot. Not a description of the whole photograph.",
      },
      aspect: {
        type: "STRING",
        description:
          "The shape to hold the cut to, when the director asked for a format. Leave it out to frame around the subject, which is the right answer for a reference nobody is composing to a format.",
        enum: [...CROP_ASPECT_IDS],
      },
      boardId: {
        type: "STRING",
        description:
          "The board this cut is for, when it is being made to fill a slot — the frame must already be on that board. The cut takes the frame's place there the moment the director accepts it, so do not call swap_on_board for it afterwards; tell them to take the cut and the board follows.",
      },
    },
    required: ["referenceId", "intention"],
  },
};

export const INSPECT_BOARD: ToolDeclaration = {
  name: "inspect_board",
  description:
    "Read a board the director already has: which pictures are on it, in the order they read, the lines set on it, and which pictures sit loosely in their place with page showing around them. Costs nothing and changes nothing, and it shows the board beside your reply. Call it before you change a board, whenever they ask what is on one, and when they ask how a board looks or whether it fits — never rebuild a board to find out what it holds.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from the boards listed in your instructions.",
      },
    },
    required: ["boardId"],
  },
};

/// How many pictures one call may exchange. A swap is free, so this is a
/// legibility ceiling rather than a cost one: past a handful the director is
/// being told about a rearrangement they did not ask for, and `compose_moodboard`
/// is the tool for that.
export const SWAP_LIMIT = 4;

export const SWAP_ON_BOARD: ToolDeclaration = {
  name: "swap_on_board",
  description:
    `Put one picture on a board in the place of another and leave the board otherwise exactly as it is — the replacement takes the place the old one had and nothing else moves. This is how a cut the director has taken goes onto a board in place of the frame it came from. Name a picture the board already holds as putOn and the two trade places instead, which is how "swap those two around" or "put that one where the wide shot is" is done. It costs nothing, it lays nothing out again, and it never touches a picture you did not name, so prefer it over compose_moodboard for any picture-for-picture replacement or for moving pictures around a board they are already on: a rebuild reassigns every slot and gives back an arrangement they did not ask for. At most ${SWAP_LIMIT} exchanges a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from the boards listed in your instructions.",
      },
      swaps: {
        type: "ARRAY",
        description:
          "The exchanges to make. Each names the picture that is on the board now and the one to put in its place — call inspect_board first if you are not sure which pictures are on it. Both may be pictures the board already holds, and then they trade places.",
        items: {
          type: "OBJECT",
          properties: {
            takeOff: {
              type: "STRING",
              description: "The reference on the board now, by id.",
            },
            putOn: {
              type: "STRING",
              description:
                "The reference to put in its place, by id — usually a cut of the same photograph.",
            },
          },
          required: ["takeOff", "putOn"],
        },
      },
    },
    required: ["boardId", "swaps"],
  },
};

export const COMPOSE_MOODBOARD: ToolDeclaration = {
  name: "compose_moodboard",
  description:
    `Lay the project's pictures out as a moodboard the director can open and keep working on — a new board, or a rebuild of one they already have if you pass boardId. This is the one tool that makes something rather than reads something, so call it when a board is asked for and not to illustrate a point — show_references is for that. Offer between ${LAYOUT_MIN_BLOCKS} and ${COMPOSE_BLOCK_LIMIT} references and expect a selection: past ${LAYOUT_MAX_BLOCKS} the surplus is left off the board.`,
  parameters: {
    type: "OBJECT",
    properties: {
      intention: {
        type: "STRING",
        description:
          "What this board is for, in the director's own words — the look it argues for. Used to compose it and, unless you give a title, to name it.",
      },
      boardId: {
        type: "STRING",
        description:
          "A board to rebuild, by an id from the boards listed in your instructions. Leave it out to file a new one. A rebuild replaces what is on that board: leave referenceIds out to lay the pictures it already holds out again, use addReferenceIds/removeReferenceIds to change which of them are on it, and give referenceIds only to replace the selection outright. The lines it carries work the same way: addCaptions/removeCaptions to change them, captions only to replace them.",
      },
      referenceIds: {
        type: "ARRAY",
        description:
          "Reference ids from list_references, best first. Crops count: a cut framed for a shape is often the one that belongs on a board. Required for a new board; on a rebuild, leave it out to keep the pictures the board already has.",
        items: { type: "STRING" },
      },
      addReferenceIds: {
        type: "ARRAY",
        description:
          "On a rebuild: references to put on the board *as well as* the ones it already holds. Use this when the director wants a picture added — you cannot see what is on a board, so naming the whole set instead would drop the pictures you did not name.",
        items: { type: "STRING" },
      },
      removeReferenceIds: {
        type: "ARRAY",
        description:
          "On a rebuild: references to take off the board. What is left is laid out again, so removing one reflows the rest.",
        items: { type: "STRING" },
      },
      captions: {
        type: "ARRAY",
        description:
          "Lines to set on the board — a title, a note. Several layouts have a text block and leave it empty without one. On a rebuild, leave it out to keep the lines the board already carries; give it only to replace them all.",
        items: { type: "STRING" },
      },
      addCaptions: {
        type: "ARRAY",
        description:
          "On a rebuild: lines to set on the board *as well as* the ones it already carries. Use this to add a line — you cannot see a board's text unless you read it, so listing captions instead would delete the lines you did not repeat.",
        items: { type: "STRING" },
      },
      removeCaptions: {
        type: "ARRAY",
        description:
          "On a rebuild: lines to take off the board, quoted as inspect_board reported them. Matched on the words, so wording it differently takes nothing off and is reported back.",
        items: { type: "STRING" },
      },
      layout: {
        type: "STRING",
        description:
          "A template by name, or RANDOM to have one chosen by how many blocks are on offer. Leave it out unless the director asked for a particular shape of board: a rebuild with no template keeps the one the board is already on, and RANDOM would change the shape of a board they only asked you to add a picture to.",
        enum: [...LAYOUT_REQUESTS],
      },
      title: {
        type: "STRING",
        description:
          "What to call the board. A new board defaults to the intention; a rebuilt one keeps the name it already has unless you give one.",
      },
    },
    /// `referenceIds` is no longer required, because a rebuild's selection can
    /// come off the board itself — but a *new* board still needs one, and the
    /// executor says so rather than filing an empty board. That refusal costs a
    /// round; requiring the field would cost every rebuild the model's guess at
    /// which pictures the board already holds, which is worse and silent.
    required: ["intention"],
  },
};

/// What the project has, in the three counts that decide which tools are worth
/// declaring. Read off the same query that primes the turn, so it costs nothing.
export type ProjectState = {
  photographs: number;
  crops: number;
  boards: number;
};

/// The tools this project can actually use, rather than every tool that exists.
///
/// Declarations are the one input paid on *every round of every turn*: the six
/// below are a couple of thousand tokens of schema and prose re-sent each time
/// the model is asked anything, and a tool that cannot be called on this project
/// is that spend for nothing. So the set is a function of what the project holds:
///
/// - Nothing uploaded — no tool has anything to act on, so none are declared. A
///   director talking about the look before they have uploaded is a real turn,
///   and it should not carry the schema of six tools that can only answer "no
///   reference called that".
/// - No cuts — `list_references` exists *only* for the crops (the photographs are
///   primed), so a project nobody has cropped never needs it.
/// - No boards — `inspect_board` and `swap_on_board` both take a board id, and
///   the only ids there are come from the boards brief. `compose_moodboard`
///   stays: it is what makes the first one.
///
/// Order is fixed rather than derived, so two turns of one conversation hand the
/// model the same tools in the same order.
export function orchestratorTools({ photographs, crops, boards }: ProjectState) {
  const pictures = photographs + crops;
  return [
    ...(crops > 0 ? [LIST_REFERENCES] : []),
    ...(pictures > 0 ? [SHOW_REFERENCES, CROP_REFERENCE] : []),
    ...(boards > 0 ? [INSPECT_BOARD, SWAP_ON_BOARD] : []),
    ...(pictures > 0 ? [COMPOSE_MOODBOARD] : []),
  ];
}

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
  /// The arrangement, as the chat can draw it: every placed picture's box in
  /// percent of the page. A board is what the pictures were put *into*, so one
  /// photograph off it is the one thing that is not a picture of the board.
  /// Null only when there is nothing placed to draw; the cover is the fallback.
  preview: BoardPreview | null;
};

/// A cut the cropper has offered and nothing has been cut of yet.
///
/// The only attachment that is not a thing the project holds — it is a thing the
/// project *could* hold, and the click on it is not "go and look at this" but
/// "take this or leave it". So it carries the whole offer rather than an id:
/// there is no row to fetch it back from, and re-asking for it would be a second
/// vision call to arrive at a box the chat is already drawing.
export type CropAttachment = {
  kind: "crop";
  /// The frame the cut would come out of — the bytes the tile draws, and the row
  /// whose properties panel the offer is reviewed in.
  referenceId: string;
  title: string;
  caption: string;
  thumbUrl: string;
  /// Where in that thumbnail the cut is, so the tile shows the picture being
  /// offered rather than the one it comes out of. Null when the frame's pixel
  /// size was never recorded and the cut's shape is therefore unknown; the tile
  /// then shows the frame, which is the honest fallback.
  preview: CropPreview | null;
  offer: CropOffer;
};

export type ChatAttachment = ReferenceAttachment | BoardAttachment | CropAttachment;

/// What makes two attachments the same attachment. A model that lists a board
/// and then talks about it has answered once.
///
/// A crop is keyed by its box as well as its frame: two cuts of one photograph
/// are two different offers, and the whole reason to ask for both in a turn is
/// to be shown them side by side.
export function attachmentKey(attachment: ChatAttachment) {
  if (attachment.kind === "board") return `board:${attachment.boardId}`;
  if (attachment.kind === "crop") {
    return `crop:${attachment.referenceId}:${attachment.offer.cropBox.join(",")}`;
  }
  return `reference:${attachment.referenceId}`;
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
  page,
  images,
  thumbUrl,
  preview = null,
}: {
  id: string;
  title: string;
  /// The template the board is standing in — passed by the compose that just
  /// laid it out, and by a read of a board still sitting in its slots
  /// (`standsAsComposed`). A board the director has rearranged is no longer the
  /// shape of the template it started as, so it passes none and the page says
  /// what it is instead.
  layout?: LayoutId;
  page?: { width: number; height: number };
  images: number;
  thumbUrl: string | null;
  preview?: BoardPreview | null;
}): BoardAttachment {
  const shape = layout ? layoutLabel(layout) : page ? `${page.width}×${page.height}` : "";
  return {
    kind: "board",
    boardId: id,
    title: title.trim() || "Untitled board",
    caption: `${images} ${images === 1 ? "photograph" : "photographs"}${shape ? ` · ${shape}` : ""}`,
    thumbUrl,
    preview,
  };
}

/// An offer, as the chat draws it: the cut itself, under the name of what it
/// keeps, with the readings that decide whether it is worth taking.
///
/// There is no file of the cut, so the picture is the frame's own thumbnail with
/// everything outside the box off the edge of the tile — computed here rather
/// than in the chat because it takes the frame's pixel size, which is the one
/// thing about the frame that never crosses the wire.
export function cropAttachmentOf(
  reference: Pick<ToolReference, "id" | "thumbUrl" | "width" | "height">,
  offer: CropOffer,
): CropAttachment {
  return {
    kind: "crop",
    referenceId: reference.id,
    title: cropOfferTitle(offer),
    caption: cropOfferCaption(offer, reference),
    thumbUrl: reference.thumbUrl,
    preview: cropPreview(offer.cropBox, reference),
    offer,
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
      /// The cut the click was actually on, when what was shown is a version
      /// rather than a photograph. tech-spec §IV: a crop opens the original's
      /// properties *at* that version — the frame alone is the right panel and
      /// the wrong answer, since a frame with nine cuts under it leaves the
      /// director hunting the row the assistant just showed them.
      versionId?: string;
      /// The cut being offered on that frame, when the click was on an offer
      /// rather than on a picture. The panel is where a box is judged — over the
      /// frame, at the size the frame is shown — so the click hands the offer to
      /// the review that already exists instead of opening a second one in the
      /// chat.
      offer?: CropOffer;
    }
  /// A board opens as a board: the composed scene is the thing to look at, and
  /// the tab row is where it is then renamed, duplicated or thrown away.
  | { view: "moodboard"; boardId: string };

export function attachmentTarget(attachment: ChatAttachment): AttachmentTarget {
  if (attachment.kind === "board") return { view: "moodboard", boardId: attachment.boardId };
  if (attachment.kind === "crop") {
    return { view: "gallery", inspectId: attachment.referenceId, offer: attachment.offer };
  }
  if (attachment.frameId) {
    return {
      view: "gallery",
      inspectId: attachment.frameId,
      versionId: attachment.referenceId,
    };
  }
  return { view: "gallery", inspectId: attachment.referenceId };
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

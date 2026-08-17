import { ANALYSIS_DIMENSIONS, tagLabel, type AnalysisProperties } from "@/lib/analysis/analysis";
import {
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
  cropShapeAt,
  referenceCaption,
} from "@/lib/references/reference-version";
import {
  cropOfferCaption,
  cropOfferTitle,
  cropPreview,
  type CropOffer,
  type CropPreview,
} from "@/lib/crop/crop-offer";
import type { BoardPreview } from "@/lib/boards/board-preview";
import type { UsingBoard } from "@/lib/references/reference-usage";
import {
  LAYOUT_MAX_BLOCKS,
  LAYOUT_MAX_TEXT_BLOCKS,
  LAYOUT_MIN_BLOCKS,
  LAYOUT_REQUESTS,
  LAYOUTS_WITH_TEXT,
  layoutLabel,
  type LayoutId,
} from "@/lib/layout/moodboard-layouts";
import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";

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

/// How much of the director's own brief is primed into a turn.
///
/// Not a readability cap. The column holds 5,000 characters, which is roughly
/// 1,250 tokens on *every model call of every turn*, against a base measured at
/// ~3,800 (§VI) — so a brief written to the column's limit would be a third of
/// the bill of every turn, including the ones that never mention it. Cut on a
/// word boundary and said out loud, because a director's own words silently
/// halved is the model answering from half a brief while believing it has read
/// the whole one.
export const DIRECTOR_BRIEF_LIMIT = 1200;

/// What the director said this project is, in their own words.
///
/// The one thing in the priming that nobody and nothing derived: the title they
/// typed and the brief they wrote. Everything else in a turn is read off pixels
/// (agent 2's tags), off the file (shape, size) or off a row the pipeline itself
/// wrote (cuts, boards). This is the standing intent all of that is *for*, and
/// it sat in a column nothing read while the header rendered it above the chat.
///
/// First in the priming rather than last: the catalog and the boards are read
/// against it, not the other way round.
export function directorBrief({
  title,
  brief,
}: {
  title: string;
  brief?: string | null;
}) {
  const named = title.trim() || "Untitled project";
  const words = (brief ?? "").trim().replace(/\s+/g, " ");

  /// The title is said either way and the note is not. Naming the project costs
  /// a handful of tokens and is itself the director's own word for the work;
  /// the paragraph explaining what a brief outranks is about a value this
  /// project does not have, and would be paid on every model call of every turn
  /// to describe an absence.
  if (!words) {
    return `This project is called “${named}”. The director has not written a brief for it.`;
  }

  const cut = clampWords(words, DIRECTOR_BRIEF_LIMIT);
  return [
    `This project is called “${named}”. The director's brief for it, in their own words:`,
    cut.text,
    cut.truncated
      ? `(That is the first ${cut.text.length} characters of a longer brief — do not treat it as the whole of what they wrote.)`
      : "",
    DIRECTOR_BRIEF_NOTE,
  ]
    .filter(Boolean)
    .join("\n");
}

/// What the brief is and what to do with it, said once and only to a project
/// that has one.
///
/// Three things the model cannot work out from the text itself: that it outranks
/// anything read off a picture when deciding what matters, that this message
/// wins where the two disagree — a director asking for something the brief does
/// not mention is changing their mind, not making a mistake — and that the
/// assistant has no way to write it, so a brief that has gone stale is something
/// to mention rather than to work around.
const DIRECTOR_BRIEF_NOTE = `That brief is the director's own statement of what this project is for, not anything read off a picture: read what they ask against it when deciding which references matter, how a cut is framed and what a board argues. What they say in this conversation wins where the two disagree. You cannot write or change the brief — it is theirs, edited above the gallery — so say so if it looks out of date rather than working around it.`;

/// Cut to a length without cutting a word in half, and say whether it cut.
function clampWords(text: string, limit: number) {
  if (text.length <= limit) return { text, truncated: false };
  const head = text.slice(0, limit);
  const lastSpace = head.lastIndexOf(" ");
  return { text: (lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd(), truncated: true };
}

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

  /// "The most recent" was the wrong description of a truncated list and always
  /// had been: the gallery is ordered starred-first and only then by date, so the
  /// slice that survives `limit` is the director's own picks plus the newest of
  /// the rest. A head that says otherwise is the model being told the wrong thing
  /// about which photographs it is *not* being shown.
  const starred = digests.some((digest) => digest.favorite);
  const head =
    shown < total
      ? `The project holds ${total} photographs. ${shown} of them, ${starred ? "starred first and then newest" : "newest first"}:${cuts}`
      : `The project holds ${total} ${total === 1 ? "photograph" : "photographs"}:${cuts}`;

  return [head, ...digests.map(digestLine), starredNote(digests), unreadNote(digests)]
    .filter(Boolean)
    .join("\n");
}

/// One reference on one line, in the order a director reads it: what to call it
/// by, what it is called, whether they marked it, what shape it is, and what it
/// is of.
function digestLine({ id, title, favorite, shape, keeps, tags, unread }: ReferenceDigest) {
  return [
    id,
    title,
    favorite && STARRED_MARK,
    shape,
    keeps,
    tags?.join(", "),
    unread && UNREAD_MARK[unread],
  ]
    .filter(Boolean)
    .join(" · ");
}

/// The director's own mark, in one word. Ahead of the shape rather than after the
/// tags: the tags are a comma list, and a word appended to the end of one reads
/// as another tag.
const STARRED_MARK = "starred";

/// What the star means, said once and only to a project that has one.
///
/// The gallery's star is the one thing in this pipeline the director says about a
/// picture in their own voice — agent 2's tags are read off the pixels and the
/// title is usually a filename. It costs one word a line and it is the only
/// signal that answers "which of these matters", which is the question every slot
/// assignment and every truncated list is deciding by proxy.
function starredNote(digests: readonly ReferenceDigest[]) {
  const starred = digests.filter((digest) => digest.favorite).length;
  if (!starred) return "";
  return `${starred === 1 ? "The picture" : "The pictures"} marked “${STARRED_MARK}” ${starred === 1 ? "is one" : "are ones"} the director starred in the gallery — their own pick, not anything read off the image. Prefer ${starred === 1 ? "it" : "them"} when choosing what to show or what to put on a board, and give ${starred === 1 ? "it" : "them"} the largest slot unless the director says otherwise. You cannot star or unstar a picture — that is theirs to do.`;
}

/// Why a picture's line carries no tags.
///
/// A photograph agent 2 has not read yet and one it read and found nothing in
/// are the same blank space at the end of a line, and the difference is the
/// whole difference between "this picture is plain" and "nobody has looked at
/// it". The analyzer runs out of band — a director who uploads eight frames and
/// asks for a moodboard in the same breath is asking about pictures whose tags
/// have not landed — so the blank is the common case on the turn that matters
/// most, not an edge one.
///
/// Three reasons rather than one, because they need three different next steps:
/// a queued run arrives on its own, a failed one has to be asked for again, and
/// a reference with no run at all was never offered to agent 2. An unmarked line
/// with no tags therefore means what it should — read, and nothing came of it.
export type UnreadReason = "pending" | "failed" | "never";

/// Three or four tokens on a line, against a sentence of explanation carried
/// once under the list. A project whose pictures are all read pays neither.
const UNREAD_MARK: Record<UnreadReason, string> = {
  pending: "not read yet",
  failed: "could not be read",
  never: "never read",
};

/// What the marks mean, said once. Only when something is marked — the note is
/// the expensive half and a project agent 2 has finished with should not carry
/// a paragraph about a state none of its pictures are in.
function unreadNote(digests: readonly ReferenceDigest[]) {
  const unread = digests.filter((digest) => digest.unread);
  if (!unread.length) return "";

  const pending = unread.some((digest) => digest.unread === "pending");
  /// Two states and two different next steps: a queued run arrives on its own,
  /// while a failed one and a picture nobody ever queued will not, and are what
  /// `read_references` is for. Said only for the states this project is actually
  /// in — and the second sentence is gated on exactly what the declaration is,
  /// so the instruction never names a call the model was not given.
  const stalled = unread.some((digest) => digest.unread !== "pending");
  return [
    `${unread.length} of these ${unread.length === 1 ? "has" : "have"} not been read by the property analyzer, so ${unread.length === 1 ? "its look is" : "their looks are"} unknown rather than plain — do not describe ${unread.length === 1 ? "it" : "them"} as having no colour, light or texture, and say so if the director asks about ${unread.length === 1 ? "it" : "them"}.`,
    pending
      ? "The ones marked “not read yet” are still being read and will have tags in a moment."
      : "",
    stalled
      ? "The ones marked “could not be read” or “never read” will not get tags on their own — call read_references with their ids to have the property analyzer read them."
      : "",
    "A picture with no tags can still be shown, cropped and put on a board — the arrangement is made on shape alone.",
  ]
    .filter(Boolean)
    .join(" ");
}

/// The same thing said to a *tool answer* rather than to the instruction. The
/// catalog carries `unread` on the digest, which is a word the model has to
/// interpret; this is the one sentence that says what to do about it, and it is
/// only attached when something in that answer is marked.
export const UNREAD_CATALOG_NOTE =
  "a picture marked “unread” has not been read by the property analyzer — its look is unknown rather than plain, so do not say what it is of. “pending” arrives on its own; “failed” and “never” will not, and read_references is how they are read.";

/// Which of the three reasons a reference with no analysis is under, read off
/// its latest analyzer run. Null means it was read: a run that succeeded wrote
/// an `Analysis` row, so a succeeded run beside no properties is a picture the
/// model found nothing in rather than one nobody looked at.
export function unreadReason(
  run: { status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" } | null | undefined,
): UnreadReason | null {
  if (!run) return "never";
  if (run.status === "QUEUED" || run.status === "RUNNING") return "pending";
  return run.status === "FAILED" ? "failed" : null;
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

/// A project with one of everything: what the declarations below say when
/// nothing about the project rules anything out.
const EVERYTHING: ProjectState = { photographs: 1, crops: 1, boards: 1, stalled: 1 };

/// Where the ids a tool takes come from, said as this project can answer it.
///
/// The photographs are primed into the instruction on every turn; the *cuts* are
/// only reachable through `list_references`, which is declared only for a
/// project that has one (`orchestratorTools`). So a description that sends the
/// model there unconditionally names a call half the projects in this app were
/// never handed — the instruction has been gated on that count since it learned
/// to be, and the declarations it points at were not.
function idsFrom(crops: number) {
  return crops > 0 ? "the list in your instructions or list_references" : "the list in your instructions";
}

/// A declaration is paid on every model call of every turn, so the rule
/// `orchestratorTools` follows for the *list* — a tool this project cannot call
/// is that spend for nothing — holds one level in, for what a declaration says.
/// A parameter that takes a board id on a project with no boards is schema for a
/// call that cannot be made, and a clause about cuts on a project nobody has
/// cropped is prose that cannot be acted on. Both are gated on the same counts,
/// re-read per round, so the turn that files the first board gets them back on
/// the round after it.
export function showReferencesFor({ crops }: ProjectState): ToolDeclaration {
  return {
    name: "show_references",
    description: `Put pictures in front of the director, in the chat, beside your reply. Use it whenever you talk about specific references — a name in prose is not a picture. At most ${SHOWN_LIMIT} at a time, in the order they should be read.`,
    parameters: {
      type: "OBJECT",
      properties: {
        referenceIds: {
          type: "ARRAY",
          description: `Reference ids from ${idsFrom(crops)}, in reading order.`,
          items: { type: "STRING" },
        },
      },
      required: ["referenceIds"],
    },
  };
}

/// Every declaration below with everything switched on — the shape a project
/// that has cuts and boards is handed, and the one thing that reads a tool's
/// `name` needs. `orchestratorTools` builds the narrower ones per project.
export const SHOW_REFERENCES = showReferencesFor(EVERYTHING);

/// How many pictures one turn may send to the property analyzer.
///
/// A vision call each, out of band: nothing here waits for them and nothing in
/// this reply carries their tags, so the ceiling is about the bill rather than
/// about what fits in an answer. Counted across the turn rather than per call,
/// because a model told "these four could not be read" and given three rounds
/// would otherwise be free to ask three times.
export const READ_LIMIT = 8;

export const READ_REFERENCES: ToolDeclaration = {
  name: "read_references",
  description:
    `Send pictures to the property analyzer, which reads a photograph for its colour, light, texture, composition, subject and depth — the tags every other tool judges by. For the ones marked “could not be read” or “never read”, which will not get tags on their own. The ones marked “not read yet” are already on their way and only need this if the director says one has been stuck. The reading happens in the background: no tags come back in this reply, so say you have asked for them rather than describing what the pictures turn out to be. At most ${READ_LIMIT} a turn.`,
  parameters: {
    type: "OBJECT",
    properties: {
      referenceIds: {
        type: "ARRAY",
        description:
          "The pictures to have read, by the ids they are listed under. Only ones that carry an unread mark — a picture that already has tags is not read again.",
        items: { type: "STRING" },
      },
    },
    required: ["referenceIds"],
  },
};

export function discardReferenceFor({ crops, boards }: ProjectState): ToolDeclaration {
  return {
    name: "discard_reference",
    description: [
      "Offer to take a picture out of the project altogether. This deletes nothing: what it does is put that picture in front of the director with a Remove button on it, and they decide.",
      `Call it when they ask for a picture to go ("bin that one", "I don't want the blurry frame"${crops > 0 ? ', "delete that old crop"' : ""}).`,
      /// What a removal costs is a function of what the project holds: with no
      /// cuts nothing cascades, and with no boards nothing is left with a gap.
      `The answer says what would go with it${
        crops > 0 ? " — deleting a photograph deletes every cut made of it" : ""
      }${
        boards > 0
          ? `${crops > 0 ? ", and any board showing it or one of its cuts" : " — any board showing it"} is left with a gap`
          : ""
      } — so say that and leave the choice with them; never that the picture is gone, deleted or removed.`,
      "Offer only the picture they named, since this cannot be undone once they take it.",
      boards > 0
        ? "Taking a picture off a board while keeping it in the project is a different act and a free one: that is compose_moodboard's removeReferenceIds."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        referenceId: {
          type: "STRING",
          description: `The picture to offer for removal${
            crops > 0 ? " — a photograph or a cut —" : ""
          } by an id from ${idsFrom(crops)}.`,
        },
      },
      required: ["referenceId"],
    },
  };
}

export const DISCARD_REFERENCE = discardReferenceFor(EVERYTHING);

/// How many cuts one turn of the conversation may ask for.
///
/// Every other tool here is a database read; this one is a vision call on a
/// photograph, which is the most expensive thing this app does. A model that
/// answers "crop them all for the board" with eight of them has spent the
/// afternoon's budget on boxes nobody has looked at yet — and the director can
/// only read so many offers at once anyway.
export const CROP_CALL_LIMIT = 2;

export function cropReferenceFor({ crops, boards }: ProjectState): ToolDeclaration {
  return {
    name: "crop_reference",
    description: `Ask the cropper for the part of one reference that is the shot the director described. It does not change anything: what comes back is an offer drawn on the frame, which the director accepts or declines in the reference's properties panel. One reference per call and at most ${CROP_CALL_LIMIT} a turn — reading a photograph is the most expensive thing you can ask for, so crop when a cut is asked for and pick the one frame it is about.`,
    parameters: {
      type: "OBJECT",
      properties: {
        referenceId: {
          type: "STRING",
          /// The nudge is the whole second half of this parameter and it is only
          /// reachable through a cut's id — on a project nobody has cropped there
          /// is no such id to pass.
          description: [
            `The reference to cut, by an id from ${idsFrom(crops)}.`,
            crops > 0
              ? "Give the id of a *cut* when the director wants a cut they already have changed — wider, tighter, more headroom: that is asked of the frame it came out of with its box attached, so the answer moves their cut instead of taking a smaller piece out of it, and it keeps the shape that cut was made at unless a new one is named."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        },
        intention: {
          type: "STRING",
          description:
            "What the director wants out of the frame, in their own words — the subject, the part of it, the shot. Not a description of the whole photograph.",
        },
        aspect: {
          type: "STRING",
          description: `The shape the director asked for, said one of two ways. A *format* is a ratio, width:height — ${CROP_ASPECT_IDS.join(", ")} are the usual ones, but any ratio they name is cut exactly as said, "5:4" for a print, "2.35:1" for that scope. A *loose* shape is one of ${LOOSE_SHAPE_IDS.join(", ")}, and it is what to pass when they described a shape without naming a number — "make it square", "a tall one", "not so wide": the cut is framed that way around the subject instead of being cut to a ratio they did not ask for. Pass what they asked for rather than the nearest of the usual formats. Leave it out to frame around the subject, which is the right answer for a reference nobody is composing to a shape.`,
        },
        /// The whole parameter is about a board, so on a project with none it is
        /// a field the model is charged for on every call and can never fill.
        ...(boards > 0
          ? {
              boardId: {
                type: "STRING",
                description:
                  "The board this cut is for, when it is being made to fill a slot — the picture it would replace, the frame or the cut you are changing, must already be on that board. Pass it whenever the cut is for a board: it holds the cut to that slot's own shape, which is often not one of the shapes above, so the picture fills the opening exactly. The cut takes that picture's place there the moment the director accepts it, so do not call swap_on_board for it afterwards; tell them to take the cut and the board follows.",
              },
            }
          : {}),
      },
      required: ["referenceId", "intention"],
    },
  };
}

export const CROP_REFERENCE = cropReferenceFor(EVERYTHING);

export const INSPECT_BOARD: ToolDeclaration = {
  name: "inspect_board",
  description:
    "Read a board the director already has: which pictures are on it, in the order they read, the lines set on it, the pages it is laid out on, and which pictures sit loosely in their place with page showing around them. Costs nothing and changes nothing, and it shows the board beside your reply. Call it before you change a board, whenever they ask what is on one, and when they ask how a board looks or whether it fits — never rebuild a board to find out what it holds. A board is one or more pages, each a fixed-size rectangle with its own name: read it without a pageId to see them all listed, then read it again naming one to see what is on that page alone.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from the boards listed in your instructions.",
      },
      pageId: {
        type: "STRING",
        description:
          "One page of that board, by an id from a pages list this tool gave you — leave it out to read the whole board and have its pages listed. Naming a page reads that page alone: the pictures and lines on it in reading order, and which of them run over its edge and are drawn cut off. Read the page the director is talking about before you change it, since a picture on page 2 is not on the board's first page.",
      },
    },
    required: ["boardId"],
  },
};

export const DUPLICATE_BOARD: ToolDeclaration = {
  name: "duplicate_board",
  description:
    "Make a second board holding exactly what a board they already have holds — the same pictures in the same places, the same lines, the same page — and leave the original untouched. It costs nothing, decides nothing and lays nothing out again. This is how a *variation* is started: call it first whenever they want to try something without losing the board that works (\"another version of this\", \"keep that one and try it with the tall shot\"), then change the copy with swap_on_board, reword_on_board or compose_moodboard. Every other board tool changes the board they are looking at, so a board worth keeping has to be copied before it is changed rather than after.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board to copy, by an id from the boards listed in your instructions.",
      },
      title: {
        type: "STRING",
        description:
          "What to call the copy. Leave it out unless the director named it: the copy is otherwise named after the board it came from, which is what tells the two apart in the tab row.",
      },
    },
    required: ["boardId"],
  },
};

export const DISCARD_BOARD: ToolDeclaration = {
  name: "discard_board",
  description:
    "Offer to throw a board away. This deletes nothing: what it does is put that board in front of the director with a Discard button on it, and they decide. So say what is on the board they would be losing and leave the choice with them — never that the board is gone, deleted or removed. Call it when they ask for a board to go (\"bin that one\", \"delete the copy\", \"I don't need the first version\"). Offer only the board they named: a discard cannot be undone once they take it, so never offer to tidy up boards they did not mention, and never offer one after a duplicate or a rebuild unless they asked. Discarding a board takes none of its photographs out of the gallery.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description:
          "The board to offer for discarding, by an id from the boards listed in your instructions.",
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

/// How many lines one call may rewrite. Free, like a swap, so this is the same
/// legibility ceiling: past a handful the director is being handed a board whose
/// text they no longer recognise.
export const REWORD_LIMIT = 4;

export const REWORD_ON_BOARD: ToolDeclaration = {
  name: "reword_on_board",
  description:
    `Change the words of a line of text on a board and leave the board otherwise exactly as it is — the line keeps its place and every picture stays in the slot it is in. This is how a typo is fixed, a headline is rewritten or a caption is put in different words. It costs nothing and lays nothing out again, so prefer it over compose_moodboard for any change to the wording of a line that is already on the board: a rebuild reassigns every slot and gives back an arrangement they did not ask for. Use compose_moodboard's addCaptions/removeCaptions only to add a line the board does not carry or take one off it. At most ${REWORD_LIMIT} lines a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from the boards listed in your instructions.",
      },
      rewordings: {
        type: "ARRAY",
        description:
          "The lines to rewrite. Each names the line as the board carries it now and the words to put in its place — read the board with inspect_board first and quote the line, since matching is on the words and a wording the board does not carry changes nothing.",
        items: {
          type: "OBJECT",
          properties: {
            from: {
              type: "STRING",
              description: "The line as it is on the board now, quoted as inspect_board reported it.",
            },
            to: {
              type: "STRING",
              description:
                "What it should say instead. To take the line off the board entirely, use compose_moodboard's removeCaptions rather than an empty string.",
            },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["boardId", "rewordings"],
  },
};

/// The largest declaration in the layer, and five of its ten parameters are
/// about rebuilding a board — a call a project with no boards cannot make. They
/// are the ones gated: a schema is paid on every model call of every turn, and a
/// field with no id that could fill it is that spend for nothing.
export function composeMoodboardFor({ crops, boards }: ProjectState): ToolDeclaration {
  const rebuild = boards > 0;
  return {
    name: "compose_moodboard",
    description: `Lay the project's pictures out as a moodboard the director can open and keep working on${
      rebuild ? " — a new board, or a rebuild of one they already have if you pass boardId" : ""
    }. This is the one tool that makes something rather than reads something, so call it when a board is asked for and not to illustrate a point — show_references is for that. Offer between ${LAYOUT_MIN_BLOCKS} and ${COMPOSE_BLOCK_LIMIT} references and expect a selection: past ${LAYOUT_MAX_BLOCKS} the surplus is left off the board.`,
    parameters: {
      type: "OBJECT",
      properties: {
        intention: {
          type: "STRING",
          description:
            "What this board is for, in the director's own words — the look it argues for. Used to compose it and, unless you give a title, to name it.",
        },
        ...(rebuild
          ? {
              boardId: {
                type: "STRING",
                description:
                  "A board to rebuild, by an id from the boards listed in your instructions. Leave it out to file a new one. A rebuild replaces what is on that board: leave referenceIds out to lay the pictures it already holds out again, use addReferenceIds/removeReferenceIds to change which of them are on it, and give referenceIds only to replace the selection outright. The lines it carries work the same way: addCaptions/removeCaptions to change them, captions only to replace them.",
              },
              pageId: {
                type: "STRING",
                description:
                  "Which page of that board to lay out, by an id from an inspect_board pages list. A board is one or more pages and this composes one of them: the pictures and lines already on that page are what a rebuild keeps, and the board's other pages are not touched. Leave it out on a board of one page. On a board of several, read it with inspect_board first and name the page the director is talking about — left out there, the first page is the one that gets laid out again. With newPage it means something else: the page the new one goes beside.",
              },
              newPage: {
                type: "BOOLEAN",
                description:
                  "Put this arrangement on a page of its own, added to that board — for “put those on another page”, “a second page for the exteriors”, anything that asks for more board rather than a different one. Nothing already on the board is read, moved or written over: the new page lands clear to the right of it, so referenceIds is the whole of what goes on it and there is nothing to add to or keep. Leave it out to lay out a page the board already has, which is what a rebuild is.",
              },
            }
          : {}),
        referenceIds: {
          type: "ARRAY",
          description: [
            `Reference ids from ${idsFrom(crops)}, best first.`,
            crops > 0
              ? "Crops count: a cut framed for a shape is often the one that belongs on a board."
              : "",
            rebuild
              ? "Required for a new board; on a rebuild, leave it out to keep the pictures the board already has."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          items: { type: "STRING" },
        },
        ...(rebuild
          ? {
              addReferenceIds: {
                type: "ARRAY",
                description:
                  "On a rebuild: references to put on the board *as well as* the ones it already holds. Use this when the director wants a picture added — you cannot see what is on a board, so naming the whole set instead would drop the pictures you did not name. Nothing already on the board moves: the picture goes into a free place, and only a board with no room left for it is laid out again.",
                items: { type: "STRING" },
              },
              removeReferenceIds: {
                type: "ARRAY",
                description:
                  "On a rebuild: references to take off the board. Only that picture goes — everything else keeps its place, and taking one off costs no compose at all.",
                items: { type: "STRING" },
              },
            }
          : {}),
        captions: {
          type: "ARRAY",
          description: [
            `Lines to set on the board — a title, a note. Several layouts have a text block and leave it empty without one, and no template carries more than ${LAYOUT_MAX_TEXT_BLOCKS}, so a line per photograph is not a board this makes: name the ${LAYOUT_MAX_TEXT_BLOCKS} that carry the idea.`,
            rebuild
              ? "On a rebuild, leave it out to keep the lines the board already carries; give it only to replace them all."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          items: { type: "STRING" },
        },
        ...(rebuild
          ? {
              addCaptions: {
                type: "ARRAY",
                description:
                  "On a rebuild: lines to set on the board *as well as* the ones it already carries. Use this to add a line — you cannot see a board's text unless you read it, so listing captions instead would delete the lines you did not repeat. Nothing already on the board moves: the line is set in a free text block, or above the arrangement on a board the director made themselves.",
                items: { type: "STRING" },
              },
              removeCaptions: {
                type: "ARRAY",
                description:
                  "On a rebuild: lines to take off the board, quoted as inspect_board reported them. Matched on the words, so wording it differently takes nothing off and is reported back. Like addCaptions, only that line goes and nothing else moves.",
                items: { type: "STRING" },
              },
            }
          : {}),
        layout: {
          type: "STRING",
          description: [
            "A template by name, or RANDOM to have one chosen by how many blocks are on offer.",
            /// The one thing about a template the model picks blind. RANDOM
            /// seats by kind and cannot get this wrong; a name can, and a
            /// headline asked for and left off is not visible in the answer it
            /// gets back unless it reads `unplaced` as a fault rather than a
            /// choice.
            `Only ${LAYOUTS_WITH_TEXT.join(", ")} carry a line of text — with captions in hand, naming any other template leaves the line off the board, so leave this out and let RANDOM seat them.`,
            rebuild
              ? "Leave it out unless the director asked for a particular shape of board: a rebuild with no template keeps the one the board is already on, and RANDOM would change the shape of a board they only asked you to add a picture to."
              : "Leave it out unless the director asked for a particular shape of board.",
          ].join(" "),
          enum: [...LAYOUT_REQUESTS],
        },
        title: {
          type: "STRING",
          description: [
            "What to call the board. A new board defaults to the intention;",
            rebuild
              ? "a rebuilt one keeps the name it already has unless you give one. To rename a board and change nothing else, pass boardId and title alone — that renames it and leaves the arrangement exactly as it is."
              : "give one when the director named it.",
          ].join(" "),
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
}

export const COMPOSE_MOODBOARD = composeMoodboardFor(EVERYTHING);

/// What the project has, in the four counts that decide which tools are worth
/// declaring. Read off the same query that primes the turn, so it costs nothing.
export type ProjectState = {
  photographs: number;
  crops: number;
  boards: number;
  /// Pictures agent 2 will not read on its own — the ones marked "could not be
  /// read" or "never read". Deliberately not every unread picture: one already
  /// queued arrives without anybody asking, so declaring the tool for it would
  /// be a schema paid on every round of the window right after an upload, which
  /// is the one window in which nothing needs doing.
  stalled: number;
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
/// - Nothing stalled — `read_references` exists for the pictures agent 2 will
///   not get to on its own, and on a project it has finished with there are
///   none. A picture merely waiting its turn does not count: it arrives without
///   anybody asking.
/// - No boards — `inspect_board`, `duplicate_board`, `swap_on_board` and
///   `reword_on_board` all take a board id, and the only ids there are come from
///   the boards brief. `compose_moodboard` stays: it is what makes the first one.
///
/// The same counts then decide what the surviving declarations *say*: the four
/// built per state above drop the parameters and clauses that name something
/// this project has not got — a board to rebuild, a cut to nudge, a
/// `list_references` it was never handed. A field with no id that could fill it
/// is the same spend for nothing one level in, and a description naming a tool
/// the model does not have is worse than spend: it is a call it will try to make.
///
/// Order is fixed rather than derived, so two turns of one conversation hand the
/// model the same tools in the same order.
export function orchestratorTools(state: ProjectState) {
  const { photographs, crops, boards, stalled } = state;
  const pictures = photographs + crops;
  return [
    ...(crops > 0 ? [LIST_REFERENCES] : []),
    ...(pictures > 0
      ? [showReferencesFor(state), cropReferenceFor(state), discardReferenceFor(state)]
      : []),
    ...(stalled > 0 ? [READ_REFERENCES] : []),
    ...(boards > 0
      ? [INSPECT_BOARD, DUPLICATE_BOARD, SWAP_ON_BOARD, REWORD_ON_BOARD, DISCARD_BOARD]
      : []),
    ...(pictures > 0 ? [composeMoodboardFor(state)] : []),
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
  /// The star the director put on it in the gallery. Optional because a caller
  /// that has not read the column leaves it off, and an unmarked line then reads
  /// exactly as it always did.
  favorite?: boolean | null;
  source?: { id: string; title: string } | null;
  analysis?: Partial<AnalysisProperties> | null;
  /// Set only when there is no analysis to read and the reason is known. The
  /// toolset fills it from the project's analyzer runs; a caller that has not
  /// asked leaves it off, and a line with no tags then reads as it always did.
  unread?: UnreadReason | null;
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
  /// True or absent, never false: an unstarred picture is the ordinary case and
  /// `favorite: false` on twenty-three lines is the tokens of a fact nobody
  /// needed. Present, it is the director's own judgement of the set — the only
  /// one in a digest that was not read off the pixels.
  favorite?: true;
  croppedFrom?: string;
  keeps?: string;
  tags?: string[];
  /// Present only when the tags are missing *and* the reason is known, so the
  /// two silences a blank line used to carry — not read, and read with nothing
  /// found — are told apart wherever a digest goes.
  unread?: UnreadReason;
};

/// The shape of a picture, by the name a director would use for it, falling back
/// to the ratio itself. A row uploaded before the dimension columns existed has
/// no shape at all, and saying so is better than inventing a square.
export function aspectLabel(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  return cropShapeAt(width / height)?.label ?? `${(width / height).toFixed(2)}:1`;
}

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
    ...(reference.favorite && { favorite: true as const }),
    ...(reference.source && { croppedFrom: reference.source.id }),
    ...(keeps && { keeps }),
    ...(tags && { tags }),
    /// Never beside tags. A reference that has tags has been read, and marking
    /// it would be contradicting the evidence on the same line.
    ...(!tags && reference.unread && { unread: reference.unread }),
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
  /// Set only by `discard_reference`: this tile carries a decision rather than a
  /// result, and the Remove button under it is what settles it. Present or
  /// absent, never false — a picture tile is a picture tile.
  ///
  /// A payload rather than a flag, because the browser has to say what the
  /// removal *cost* after it has happened, and by then there is no row to ask:
  /// the cuts have cascaded and the boards are already showing placeholders.
  /// Same reason a board tile carries `images`.
  discard?: { cuts: number; boards: UsingBoard[] };
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
  /// What the board says, in reading order — the words themselves rather than a
  /// count of them.
  ///
  /// The miniature cannot carry them: a headline block is about 5% of a page's
  /// height, which is five pixels in a tile this size, so the one thing a
  /// director asked to *change* would be drawn as a grey bar. They are carried
  /// as strings and set beside the arrangement instead.
  ///
  /// Capped, because a hand-arranged board may hold a paragraph and this is a
  /// tile: `linesOver` counts what did not fit rather than letting the tile end
  /// on a line that reads as the last one.
  lines: string[];
  linesOver: number;
  /// How many photographs are on it. Already in the caption in words; carried as
  /// a number because the browser has to say what a board *was* after it has
  /// deleted it, and by then there is no row to count.
  images: number;
  /// Set only by `discard_board`: this tile carries a decision rather than a
  /// result. Present or absent, never false — a board tile is a board tile, and
  /// the flag is what puts the Discard button under it.
  ///
  /// A flag on the board tile rather than a fourth attachment kind, because a
  /// board offered for discarding *is* the board: same id, same key, same
  /// arrangement, same click into the tab row. The only difference is that the
  /// director can end it from here, and one board still has one tile in the
  /// strip however many ways this turn talked about it.
  discard?: true;
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

export function attachmentOf(
  reference: ToolReference,
  discard?: { cuts: number; boards: UsingBoard[] },
): ReferenceAttachment {
  return {
    kind: "reference",
    referenceId: reference.id,
    frameId: reference.source?.id ?? null,
    title: reference.title.trim() || "Untitled",
    caption: referenceCaption(reference),
    thumbUrl: reference.thumbUrl,
    ...(discard && { discard }),
  };
}

/// How many of a board's lines a tile shows, and how much of one. A board is at
/// most two lines when a template composed it; a hand-arranged one has no bound
/// at all, and neither does the length of what the director typed into it.
export const BOARD_LINES_SHOWN = 3;
export const BOARD_LINE_CHARS = 60;

function boardLines(lines: readonly string[]) {
  const said = lines.map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
  return {
    lines: said
      .slice(0, BOARD_LINES_SHOWN)
      .map((line) =>
        line.length > BOARD_LINE_CHARS ? `${line.slice(0, BOARD_LINE_CHARS - 1).trimEnd()}…` : line,
      ),
    linesOver: Math.max(0, said.length - BOARD_LINES_SHOWN),
  };
}

/// A composed board, as the chat draws it. The caption is what the board *is* —
/// how many photographs, how many lines and in what shape — rather than what it
/// is called, which is already on the tile.
export function boardAttachmentOf({
  id,
  title,
  layout,
  page,
  images,
  lines = [],
  thumbUrl,
  preview = null,
  discard = false,
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
  /// The words on the board, in reading order. A board carrying a headline and
  /// one that carries none are otherwise the same tile, which is wrong in the
  /// one reply that is *about* the headline.
  lines?: readonly string[];
  thumbUrl: string | null;
  preview?: BoardPreview | null;
  /// Whether this tile is an offer to throw the board away. Only
  /// `discard_board` passes it, and nothing else on the tile changes.
  discard?: boolean;
}): BoardAttachment {
  const shape = layout ? layoutLabel(layout) : page ? `${page.width}×${page.height}` : "";
  const said = boardLines(lines);
  const total = said.lines.length + said.linesOver;
  return {
    kind: "board",
    boardId: id,
    title: title.trim() || "Untitled board",
    caption: [
      `${images} ${images === 1 ? "photograph" : "photographs"}`,
      total ? `${total} ${total === 1 ? "line" : "lines"}` : "",
      shape,
    ]
      .filter(Boolean)
      .join(" · "),
    thumbUrl,
    preview,
    images,
    ...said,
    ...(discard && { discard: true as const }),
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
///
/// And so are the ones the limit cut off, for exactly the same reason. An id that
/// named a real reference and did not survive the slice used to appear in neither
/// list — so a call naming twelve pictures came back with eight and nothing to
/// say the other four had been asked for, which is the failure `missing` was
/// invented to prevent arriving through the other door.
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

  const kept = found.slice(0, Math.max(0, limit));
  return {
    found: kept,
    missing,
    /// Ids that answered to a reference and were cut off by the limit. Named so
    /// the caller can own the difference between what it was asked for and what
    /// it did.
    overLimit: found.slice(kept.length).map((reference) => reference.id),
  };
}

/// One conversation's attachments, in arrival order, each picture once. A model
/// that shows the same reference on two turns of one exchange means it twice;
/// the chat only has room to draw it once.
///
/// A picture and an offer are the same attachment however often they arrive —
/// the bytes of a photograph do not change, and an offer is keyed by its own box.
/// A *board* is the exception, and the instruction is what makes it one: the
/// model is told to read a board before it changes one, so the commonest two-tool
/// turn there is `inspect_board` and then an edit of the same board. First-wins
/// drew the tile from the read — the board as it was *before* the change the
/// director asked for. So a later view of a board replaces the earlier one and
/// keeps its place in the strip: the position is where the conversation first
/// mentioned it, the content is how it now stands.
export function mergedAttachments(
  current: readonly ChatAttachment[],
  added: readonly ChatAttachment[],
) {
  const merged = [...current];
  const at = new Map(merged.map((attachment, index) => [attachmentKey(attachment), index]));

  for (const attachment of added) {
    const key = attachmentKey(attachment);
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, merged.length);
      merged.push(attachment);
    } else if (attachment.kind === "board") {
      merged[seen] = attachment;
    }
  }

  return merged;
}

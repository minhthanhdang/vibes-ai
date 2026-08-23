import { ReferenceOrigin } from "@/generated/prisma/enums";
import {
  ANALYSIS_DIMENSIONS,
  tagLabel,
  type AnalysisProperties,
  type TagDimension,
} from "@/lib/analysis/analysis";
import {
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
  cropShapeAt,
  referenceCaption,
} from "@/lib/references/reference-version";
import type { BoardPreview } from "@/lib/boards/board-preview";
import type { UsingBoard } from "@/lib/references/reference-usage";
import {
  LAYOUT_MAX_BLOCKS,
  LAYOUT_MAX_TEXT_BLOCKS,
  LAYOUT_MIN_BLOCKS,
  LAYOUT_REQUESTS,
  LAYOUT_TEXT_MAX_FONT,
  LAYOUT_TEXT_MIN_FONT,
  LAYOUTS_WITH_TEXT,
  PAGE_PRESET_IDS,
  layoutLabel,
  type LayoutName,
} from "@/lib/layout/moodboard-layouts";
import {
  CANVAS_STROKE_MAX,
  CANVAS_TEXT_MAX_FONT,
  FONT_NAMES,
} from "@/lib/canvas-objects/object-style";
import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";
import { CANVAS_BACKGROUND_DEFAULT } from "@/lib/boards/board-background";
import { PAGE_BACKGROUND_NONE } from "@/lib/pages/page-background";

/// The contract between the agents and everything they are allowed to touch
/// (tech-spec §III). Tools.md §I–VI.
///
/// Kept pure and out of `server/` because both sides need it: the executor
/// builds these values, the chat renders them.

/// The function-calling shape Vertex takes, declared once and here rather than
/// taken from the SDK: every declaration below writes `type: "OBJECT"` as a
/// string literal and the SDK's `Schema` wants its `Type` enum, so the cast is
/// made once, at the seam. tech-spec §VII; Tools.md §I.1.
export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/// How many references one catalog answer carries — a cost ceiling first and a
/// readability one second. Tools.md §II.2.
export const CATALOG_LIMIT = 24;

/// How many references one `show_references` call may put in the chat.
/// Tools.md §IV.2.
export const SHOWN_LIMIT = 8;

export const LIST_REFERENCES: ToolDeclaration = {
  name: "list_references",
  description:
    "The pictures in this project — the photographs and the cuts made of them — each with its id, title, shape, what a cut keeps and the properties agent 2 read off it. This is the door to every picture and what is known about it. The photographs are also primed into your instructions and read fresh for this message; the cuts are only ever here.",
  parameters: {
    type: "OBJECT",
    properties: {
      includeCrops: {
        type: "BOOLEAN",
        description:
          "The cuts are listed with the photographs. Pass false to leave them out and answer with the uploads alone.",
      },
    },
  },
};

/// How much of the project brief is primed into a turn. Not a readability cap —
/// the column holds 5,000 characters, roughly 1,250 tokens on every model call
/// of every turn (§VI). Cut on a word boundary and said out loud.
/// Tools.md §II.1.
export const PROJECT_BRIEF_LIMIT = 1200;

/// What the user said this project is, in their own words — the one thing in the
/// priming that nobody and nothing derived, and first in it rather than last.
/// Tools.md §II.1.
export function projectBrief({
  title,
  brief,
}: {
  title: string;
  brief?: string | null;
}) {
  const named = title.trim() || "Untitled project";
  const words = (brief ?? "").trim().replace(/\s+/g, " ");

  /// The title is said either way and the note is not. Naming the project costs
  /// a handful of tokens and is itself the user's own word for the work;
  /// the paragraph explaining what a brief outranks is about a value this
  /// project does not have, and would be paid on every model call of every turn
  /// to describe an absence.
  if (!words) {
    return `This project is called “${named}”. The user has not written a brief for it.`;
  }

  const cut = clampWords(words, PROJECT_BRIEF_LIMIT);
  return [
    `This project is called “${named}”. The user's brief for it, in their own words:`,
    cut.text,
    cut.truncated
      ? `(That is the first ${cut.text.length} characters of a longer brief — do not treat it as the whole of what they wrote.)`
      : "",
    PROJECT_BRIEF_NOTE,
  ]
    .filter(Boolean)
    .join("\n");
}

/// What the brief is and what to do with it, said once and only to a project
/// that has one. Three things the model cannot work out from the text itself —
/// Tools.md §II.1.
const PROJECT_BRIEF_NOTE = `That brief is the user's own statement of what this project is for, not anything read off a picture: read what they ask against it when deciding which references matter, how a cut is framed and what a board argues. What they say in this conversation wins where the two disagree. You cannot write or change the brief — it is theirs, edited above the gallery — so say so if it looks out of date rather than working around it.`;

/// Cut to a length without cutting a word in half, and say whether it cut.
function clampWords(text: string, limit: number) {
  if (text.length <= limit) return { text, truncated: false };
  const head = text.slice(0, limit);
  const lastSpace = head.lastIndexOf(" ");
  return { text: (lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd(), truncated: true };
}

/// The project's photographs, written into the turn instead of fetched by a tool
/// call, as lines rather than as JSON. Tools.md §II.2.
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
  /// slice that survives `limit` is the user's own picks plus the newest of
  /// the rest. A head that says otherwise is the model being told the wrong thing
  /// about which photographs it is *not* being shown.
  const starred = digests.some((digest) => digest.favorite);
  const head =
    shown < total
      ? `The project holds ${total} photographs. ${shown} of them, ${starred ? "starred first and then newest" : "newest first"}:${cuts}`
      : `The project holds ${total} ${total === 1 ? "photograph" : "photographs"}:${cuts}`;

  return [
    head,
    ...digests.map(digestLine),
    starredNote(digests),
    madeNote(digests),
    unreadNote(digests),
  ]
    .filter(Boolean)
    .join("\n");
}

/// One reference on one line, in the order a user reads it. Tools.md §II.2.
function digestLine({ id, title, favorite, made, shape, keeps, tags, unread }: ReferenceDigest) {
  return [
    id,
    title,
    favorite && STARRED_MARK,
    made && MADE_MARK,
    shape,
    keeps,
    tags?.join(", "),
    unread && UNREAD_MARK[unread],
  ]
    .filter(Boolean)
    .join(" · ");
}

/// The user's own mark, in one word. Ahead of the shape rather than after the
/// tags, which are a comma list. agent-tools.md:148; Tools.md §II.3.
const STARRED_MARK = "starred";

/// A picture this assistant drew, in one word, beside the star and for the same
/// reason. agent-tools.md:148; Tools.md §II.3.
const MADE_MARK = "generated";

/// What the star means, said once and only to a project that has one.
/// Tools.md §II.3.
function starredNote(digests: readonly ReferenceDigest[]) {
  const starred = digests.filter((digest) => digest.favorite).length;
  if (!starred) return "";
  return `${starred === 1 ? "The picture" : "The pictures"} marked “${STARRED_MARK}” ${starred === 1 ? "is one" : "are ones"} the user starred in the gallery — their own pick, not anything read off the image. Prefer ${starred === 1 ? "it" : "them"} when choosing what to show or what to put on a board, and give ${starred === 1 ? "it" : "them"} the largest slot unless the user says otherwise. You cannot star or unstar a picture — that is theirs to do.`;
}

/// What the generated mark means, said once and only to a project holding one.
/// The second half is a claim about the rest of the list, so it is read off the
/// list. Tools.md §II.3.
function madeNote(digests: readonly ReferenceDigest[]) {
  const made = digests.filter((digest) => digest.made).length;
  if (!made) return "";
  const one = made === 1;
  const preference =
    digests.length > made
      ? `${one ? "It is theirs" : "They are theirs"} to use like any other, but a photograph they brought is the better answer wherever one fits.`
      : `Nothing else on this list is a photograph they brought, so there is none to prefer instead: reach for ${one ? "it" : "one of them"} wherever it fits rather than drawing the same thing twice, which is the dearest call here and comes back different every time.`;
  return `${one ? "The picture" : "The pictures"} marked “${MADE_MARK}” ${one ? "was" : "were"} drawn by you earlier in this project, or cut out of one that was, rather than taken by the user. ${preference}`;
}

/// Why a picture's line carries no tags. Three reasons rather than one, because
/// they need three different next steps. agent-tools.md; Tools.md §II.3.
export type UnreadReason = "pending" | "failed" | "never";

/// Three or four tokens on a line, against a sentence carried once under the
/// list. Exported because a page's blocks are said in this same format (§V.4)
/// and two wordings would be two dialects in one prompt. Tools.md §II.3.
export const UNREAD_MARK: Record<UnreadReason, string> = {
  pending: "not read yet",
  failed: "could not be read",
  never: "never read",
};

/// What the marks mean, said once and only when something is marked.
/// Tools.md §II.3.
function unreadNote(digests: readonly ReferenceDigest[]) {
  const unread = digests.filter((digest) => digest.unread);
  if (!unread.length) return "";

  const pending = unread.some((digest) => digest.unread === "pending");
  /// Two states and two different next steps: a queued run arrives on its own,
  /// while a failed one and a picture nobody ever queued will not — and no tool
  /// in this list files a reading, so the step named is the user's own panel
  /// rather than a call. Naming a call is the worse failure of the two: the model
  /// spends a round finding out the tool is not there, and tells the user it
  /// asked for something nobody was asked for. Said only for the states this
  /// project is actually in.
  const stalled = unread.some((digest) => digest.unread !== "pending");
  return [
    `${unread.length} of these ${unread.length === 1 ? "has" : "have"} not been read by the property analyzer, so ${unread.length === 1 ? "its look is" : "their looks are"} unknown rather than plain — do not describe ${unread.length === 1 ? "it" : "them"} as having no colour, light or texture, and say so if the user asks about ${unread.length === 1 ? "it" : "them"}.`,
    pending
      ? "The ones marked “not read yet” are still being read and will have tags in a moment."
      : "",
    stalled
      ? "The ones marked “could not be read” or “never read” will not get tags on their own, and you have no way to ask for a reading — the user does, from that picture's properties panel, so say that rather than offering to have them read."
      : "",
    "A picture with no tags can still be shown, cropped and put on a board — the arrangement is made on shape alone.",
  ]
    .filter(Boolean)
    .join(" ");
}

/// The same thing said to a *tool answer* rather than to the instruction, and
/// only attached when something in that answer is marked. Tools.md §II.3.
export const UNREAD_CATALOG_NOTE =
  "a picture marked “unread” has not been read by the property analyzer — its look is unknown rather than plain, so do not say what it is of. “pending” arrives on its own; “failed” and “never” will not, and only the user can ask for a reading, from that picture's properties panel.";

/// Which of the three reasons a reference with no analysis is under, read off
/// its latest analyzer run. Null means it was read. agent-tools.md;
/// Tools.md §II.3.
export function unreadReason(
  run: { status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" } | null | undefined,
): UnreadReason | null {
  if (!run) return "never";
  if (run.status === "QUEUED" || run.status === "RUNNING") return "pending";
  return run.status === "FAILED" ? "failed" : null;
}

/// A board as the model reads it, and never what is *on* it — a board's elements
/// are up to two megabytes of JSON each. Tools.md §II.4.
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
  /// How many pages the board is laid out on (§V.1). Said only when it is more
  /// than one, because a board of one page *is* that page — its size is already
  /// on the line and there is no id to choose between. On a spread it is the one
  /// fact the model cannot get any other way short of a round of inspect_board,
  /// and every page-scoped tool tells it to pass a pageId "on a board of more
  /// than one page" — an instruction it could not act on while nothing said
  /// which boards those are.
  pages?: number;
  /// What those pages are called, in reading order (§V.1: the name is the
  /// user's to edit, and it is the word they use for the page out loud).
  /// Said only on a spread, for the same reason the count is: on a board of one
  /// page the name is the board's own line said twice.
  ///
  /// It routes a sentence to a board — "put the stairwell on the exteriors page"
  /// names no board and no id, and this is the only thing in the prompt that
  /// says which board holds a page called that. The pageId still comes from
  /// inspect_board; what this saves is inspecting every spread to find out which
  /// one the user meant.
  pageNames?: readonly string[];
};

/// The one board the user has open, primed into the turn on the same terms as
/// the project's photographs, with a count of the boards it is one of. One
/// rather than every board (orchestrator-tool-reference.md §I), and the count is
/// still said on a turn showing no board. Tools.md §II.4.
export function currentBoardBrief(board: BoardDigest | null, total: number) {
  if (total <= 0) return "";

  const held = `The project holds ${total} ${total === 1 ? "board" : "boards"}`;
  /// Named only where there is another board to reach: on a project of one, the
  /// two tools can answer nothing the line above them does not already say, and
  /// a tool named to a model is a tool it will spend a round on.
  const others =
    total > (board ? 1 : 0)
      ? "list_boards names every board of this project, newest worked on first; get_board_brief says what one of them is."
      : "";

  return [
    board
      ? `${held}. The one the user has open:\n${boardLine(board)}`
      : `${held}, none of them open in front of the user.`,
    others,
  ]
    .filter(Boolean)
    .join("\n");
}

/// Every board the project holds, uncapped, as `list_boards` answers it.
///
/// Uncapped on purpose: these lines are paid once, by a model that asked for
/// them, in the round it asked in (orchestrator-tool-reference.md §I).
export function boardsList(boards: readonly BoardDigest[]) {
  return boards.map(boardLine);
}

/// One board as the model reads it, everywhere it reads one: the priming's
/// current board, `list_boards`, `get_board_brief`. A board looked up and a
/// board primed have to read identically. Tools.md §II.4.
export function boardLine({ id, title, width, height, layout, pages, pageNames }: BoardDigest) {
  return [
    id,
    title.trim() || "Untitled board",
    `${width}×${height}`,
    layout,
    pages && pages > 1 ? `${pages} pages${pagesSaid(pages, pageNames)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/// How many page names one board's line carries. Tools.md §II.4.
const PAGE_NAMES_PER_LINE = 6;

/// The pages by name, and only when the names agree with the count — a board
/// saying "3 pages" beside two names would be the model choosing between pages
/// that are not the board's. Tools.md §II.4.
function pagesSaid(pages: number, names: readonly string[] | undefined) {
  if (!names || names.length !== pages) return "";

  const shown = names.slice(0, PAGE_NAMES_PER_LINE).map(pageSaid);
  const dropped = names.length - shown.length;
  return `: ${[...shown, ...(dropped ? [`+${dropped} more`] : [])].join(", ")}`;
}

/// A page the user never named is said by its ordinal, unquoted.
/// Tools.md §II.4.
function pageSaid(name: string, index: number) {
  return name.trim() ? `“${name.trim()}”` : `page ${index + 1}`;
}

/// A project with one of everything: what the declarations below say when
/// nothing about the project rules anything out.
const EVERYTHING: ProjectState = { photographs: 1, crops: 1, boards: 1 };

/// Where the ids a tool takes come from, said as this project can answer it.
/// Tools.md §III.2.
function idsFrom(crops: number) {
  return crops > 0 ? "the list in your instructions or list_references" : "the list in your instructions";
}

/// A declaration is paid on every model call of every turn, so the rule
/// `orchestratorTools` follows for the *list* holds one level in, for what a
/// declaration says. Tools.md §III.2.
export function showReferencesFor({ crops }: ProjectState): ToolDeclaration {
  return {
    name: "show_references",
    description: `Put pictures in front of the user, in the chat, beside your reply. Use it whenever you talk about specific references — a name in prose is not a picture. At most ${SHOWN_LIMIT} at a time, in the order they should be read.`,
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

/// How many pictures one call answers with the whole of — what fits in an answer
/// rather than a bill, and per call rather than across the turn.
/// Tools.md §IV.1.
export const READ_LIMIT = 8;

export const READ_REFERENCES: ToolDeclaration = {
  name: "read_references",
  description:
    `Read the whole of what the property analyzer wrote about pictures you already have the ids of: its colour palette as hex, its own reasoning about the look, and the tags under each of light, texture, composition, subject and depth. This is the only door to the palette and the reasoning — the lines above and list_references carry the tags flattened into one list and leave both of those out — so call it when the look of a particular picture is what the user is asking about, and not to find out which pictures exist. Nothing is read afresh: a picture carrying an unread mark comes back named rather than described, and having it read is the user's own from its properties panel. The exception is a picture you drew with generate_image — that one comes back with the description it was drawn from whether or not it has been read, which is what to call this for before asking for another like it. At most ${READ_LIMIT} pictures a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      referenceIds: {
        type: "ARRAY",
        description:
          "The pictures whose properties you want, by the ids they are listed under.",
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
      "Offer to take a picture out of the project altogether. This deletes nothing: what it does is put that picture in front of the user with a Remove button on it, and they decide.",
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

/// How many cuts one turn of the conversation may ask for. At
/// `COMPOSE_BLOCK_LIMIT` because that is the size of the thing being cropped.
/// Tools.md §IV.1.
export const CROP_CALL_LIMIT = COMPOSE_BLOCK_LIMIT;

/// What the turn's last crop is refused with, said in terms of what the user has
/// in front of them rather than of what was paid for — and a stop rather than a
/// question, in all three branches. Tools.md §IV.3.
export function cropCeilingSaid(asked: number, filed: number) {
  const attempts = `${asked} ${asked === 1 ? "cut" : "cuts"}`;
  if (filed <= 0)
    return `you have asked for ${attempts} this turn and none of them could be cut — tell the user what went wrong rather than asking for another`;
  if (filed < asked)
    return `you have asked for ${attempts} this turn and ${filed} of them ${filed === 1 ? "was" : "were"} filed — that is this turn's last crop, so tell the user which cuts they have and stop cropping`;
  return `you have already filed ${attempts} this turn, which is all this turn may cut — tell the user what you cut and stop cropping`;
}

export function cropReferenceFor({ crops, boards }: ProjectState): ToolDeclaration {
  return {
    name: "crop_reference",
    description: `Ask the cropper for the part of one reference that is the shot the user described, and file it. The cut is made and filed as a new reference of this project, shown to the user beside your reply; the frame it came out of is untouched and stays where it is, and discard_reference is how a cut nobody wanted goes. The id it answers with can be given to another tool on the next round of this same turn. One reference per call and at most ${CROP_CALL_LIMIT} a turn — reading a photograph is the most expensive thing you can ask for, so crop when a cut is asked for and pick the one frame it is about.`,
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
              ? "Give the id of a *cut* when the user wants a cut they already have changed — wider, tighter, more headroom: that is asked of the frame it came out of with its box attached, so the answer moves their cut instead of taking a smaller piece out of it, and it keeps the shape that cut was made at unless a new one is named."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        },
        intention: {
          type: "STRING",
          description:
            "What the user wants out of the frame, in their own words — the subject, the part of it, the shot. Not a description of the whole photograph.",
        },
        aspect: {
          type: "STRING",
          description: `The shape the user asked for, said one of two ways. A *format* is a ratio, width:height — ${CROP_ASPECT_IDS.join(", ")} are the usual ones, but any ratio they name is cut exactly as said, "5:4" for a print, "2.35:1" for that scope. A *loose* shape is one of ${LOOSE_SHAPE_IDS.join(", ")}, and it is what to pass when they described a shape without naming a number — "make it square", "a tall one", "not so wide": the cut is framed that way around the subject instead of being cut to a ratio they did not ask for. Pass what they asked for rather than the nearest of the usual formats. Leave it out to frame around the subject, which is the right answer for a reference nobody is composing to a shape.`,
        },
        /// The whole parameter is about a board, so on a project with none it is
        /// a field the model is charged for on every call and can never fill.
        ...(boards > 0
          ? {
              boardId: {
                type: "STRING",
                description:
                  "The board this cut is for, when it is being made to fill a slot — the picture it would replace, the frame or the cut you are changing, must already be on that board. Pass it whenever the cut is for a board: it holds the cut to that slot's own shape, which is often not one of the shapes above, so the picture fills the opening exactly. The cut takes that picture's place there in this same call, so do not call swap_on_board for it afterwards — the swap is already made.",
              },
              pageId: {
                type: "STRING",
                description:
                  "One page of that board, by an id from inspect_board — pass it with boardId on a board of more than one page. The same picture can stand on two pages in two differently shaped slots, so without it the cut is held to the shape of whichever page reads first and is swapped in there. Leave it out on a board of one page.",
              },
            }
          : {}),
      },
      required: ["referenceId", "intention"],
    },
  };
}

export const CROP_REFERENCE = cropReferenceFor(EVERYTHING);

/// The door to every board that is not the one in front of the user (§II.1), and
/// cheap enough to be the round it costs — it never reads a scene, which is what
/// separates it from `inspect_board`. Tools.md §IV.4.
export const LIST_BOARDS: ToolDeclaration = {
  name: "list_boards",
  description:
    "Every board in this project, the one worked on most recently first: its id, what it is called, the size of its pages and how many pages it is laid out on. It reads nothing that is on a board, so it costs one query — this is the answer to which board is which, where inspect_board is the answer to what is on one. Your instructions name only the board the user has open, so this is where the id of every other board comes from: call it whenever they mean a board that is not the one in front of them (“the one from Tuesday”, “the square one”, “my first board”) and take the id off this answer rather than out of the conversation. Every board the project holds is listed, however many that is.",
  /// No arguments: the project is the argument, and it is the caller's rather
  /// than the model's. An empty object rather than no `parameters` key, because
  /// that is the shape the declaration is sent in.
  parameters: {
    type: "OBJECT",
    properties: {},
  },
};

/// One board's line, for a board the instruction did not carry — the pair to
/// `list_boards` and the cheaper half of it. Tools.md §IV.4.
export const GET_BOARD_BRIEF: ToolDeclaration = {
  name: "get_board_brief",
  description:
    "What one board is: the same line your instructions carry for the board the user has open — its name, the size of its pages, how many pages it is and what they are called — for any other board of this project. It reads nothing that is on the board, so it costs one query. Call it when a board has been named by an id that was not in your instructions and you need to know what it is before acting on it, and call inspect_board instead when the question is what is on it. It changes nothing and shows the user nothing.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description:
          "The board, by an id from list_boards, from the board named in your instructions, or from a tool answer earlier in this turn. An id remembered out of the conversation is a guess.",
      },
    },
    required: ["boardId"],
  },
};

export const INSPECT_BOARD: ToolDeclaration = {
  name: "inspect_board",
  description:
    "Read a board the user already has: which pictures are on it, in the order they read, the lines set on it, the pages it is laid out on, and which pictures sit loosely in their place with page showing around them. Costs nothing and changes nothing, and it shows the board beside your reply. Call it before you change a board, whenever they ask what is on one, and when they ask how a board looks or whether it fits — never rebuild a board to find out what it holds. A board is one or more pages, each a fixed-size rectangle with its own name: read it without a pageId to see them all listed, then read it again naming one to see what is on that page alone.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "One page of that board, by an id from a pages list this tool gave you — leave it out to read the whole board and have its pages listed. Naming a page reads that page alone: the pictures and lines on it in reading order, and which of them run over its edge and are drawn cut off. Read the page the user is talking about before you change it, since a picture on page 2 is not on the board's first page.",
      },
    },
    required: ["boardId"],
  },
};

export const ADD_PAGE: ToolDeclaration = {
  name: "add_page",
  description:
    "Give a board another page: an empty one, the size of the page it goes beside, drawn to the right of everything already on the board. It decides nothing and lays nothing out — no picture is chosen, nothing that is on the board moves, and no page it already has is touched — so it costs nothing and is safe to call the moment they ask for a page. Call it when they want somewhere new to put pictures (\"give me another page\", \"start a page for the night work\") and when a board they arranged by hand has no page at all: the first page on such a board is drawn around the pictures already there, which makes them that page's, so the board can then be read and composed a page at a time without being laid out again. When they want pictures *on* the new page and arranged there, call compose_moodboard with newPage instead — this tool leaves the page blank.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the new one goes beside, by an id from a pages list inspect_board gave you — it takes that page's size and its top edge. Leave it out and it follows the board's last page, which is what \"another page\" means on a spread. It never replaces the page named: a page is only ever added.",
      },
      name: {
        type: "STRING",
        description:
          "What to call it, when the user said — \"the exteriors\", \"act two\". Leave it out and it is called Page N, counted past the pages the board already carries, which the user can rename on the canvas.",
      },
    },
    required: ["boardId"],
  },
};

export const DUPLICATE_PAGE: ToolDeclaration = {
  name: "duplicate_page",
  description:
    "Copy one page of a board onto a new page of the same board: the same pictures the same size in the same places, the same lines, inside a rectangle of its own drawn to the right of everything the board already has. The page it was copied from is untouched, and every other page of the board is untouched. It costs nothing, decides nothing and lays nothing out again. This is how a *variation of a page* is started — call it first whenever they want to try something on a page without losing the arrangement that works (\"try that page with the tall shot\", \"another version of the exteriors\"), then change the copy with swap_on_board, reword_on_board or compose_moodboard naming the new pageId. Do not use duplicate_board for this: that makes a second board holding every page, so the pages they were not talking about end up in two places. Do not use compose_moodboard with newPage either — that lays the pictures out again from scratch, so what comes back is not a copy.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to copy, by an id from a pages list inspect_board gave you. Required: there is no default page to copy, and the wrong page is somebody else's work.",
      },
      name: {
        type: "STRING",
        description:
          "What to call the copy, when the user said. Leave it out and it is called Page N, counted past the pages the board already carries — the copy is never named after the page it came from, because two pages whose names differ by a bracket are two pages they cannot tell apart out loud.",
      },
    },
    required: ["boardId", "pageId"],
  },
};

export const DUPLICATE_BOARD: ToolDeclaration = {
  name: "duplicate_board",
  description:
    "Make a second board holding exactly what a board they already have holds — the same pictures in the same places, the same lines, every page of it — and leave the original untouched. It costs nothing, decides nothing and lays nothing out again. This is how a *variation* is started: call it first whenever they want to try something without losing the board that works (\"another version of this\", \"keep that one and try it with the tall shot\"), then change the copy with swap_on_board, reword_on_board or compose_moodboard. Every other board tool changes the board they are looking at, so a board worth keeping has to be copied before it is changed rather than after.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board to copy, by an id from your instructions or list_boards.",
      },
      title: {
        type: "STRING",
        description:
          "What to call the copy. Leave it out unless the user named it: the copy is otherwise named after the board it came from, which is what tells the two apart in the tab row.",
      },
    },
    required: ["boardId"],
  },
};

export const DISCARD_BOARD: ToolDeclaration = {
  name: "discard_board",
  description:
    "Offer to throw a board away. This deletes nothing: what it does is put that board in front of the user with a Discard button on it, and they decide. So say what is on the board they would be losing — every page of it, on a board of more than one — and leave the choice with them — never that the board is gone, deleted or removed. Call it when they ask for a board to go (\"bin that one\", \"delete the copy\", \"I don't need the first version\"). Offer only the board they named: a discard cannot be undone once they take it, so never offer to tidy up boards they did not mention, and never offer one after a duplicate or a rebuild unless they asked. Discarding a board takes none of its photographs out of the gallery.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description:
          "The board to offer for discarding, by an id from your instructions or list_boards.",
      },
    },
    required: ["boardId"],
  },
};

export const RESIZE_PAGE: ToolDeclaration = {
  name: "resize_page",
  description:
    "Change the shape of one page of a board and lay nothing out again: the page becomes the size you name and every picture and line on it keeps the exact place it has. This is how \"make that page portrait\", \"turn it on its side\", \"make it square\" and \"put it back to 16:9\" are done, and it is the only call that changes a page's shape without rearranging it — compose_moodboard naming a template of another shape resizes the page on its way past *and* gives back a page agent 4 laid out again, which is not what they asked for. It costs nothing and makes no model call. Read the board first: pages are told apart by an id and the wrong page is somebody else's work. Because nothing moves, a page made smaller leaves pictures beside it — they stay on the board where the user put them and stop being on that page — and a page made larger takes in whatever it now covers; both are reported back and both are worth saying out loud, and offering to lay the page out again at its new shape is usually the next thing to say.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to reshape, by an id from a pages list inspect_board gave you. Required: there is no default page, and reshaping the wrong one moves nothing but describes a different page from then on.",
      },
      preset: {
        type: "STRING",
        description:
          "The shape to give it: LANDSCAPE_HD is 1920×1080, PORTRAIT_HD is 1080×1920, SQUARE is 2048×2048. These are the shapes the layout templates are cut for, so a page at one of them is a page a compose can fill — a rectangle of any other size is the user's own to drag on the canvas. A page already at the size you name is left alone and said so.",
        enum: [...PAGE_PRESET_IDS],
      },
    },
    required: ["boardId", "pageId", "preset"],
  },
};

/// The one page tool of §IV.2's set that is not forked for agent 8, because it
/// points at the read *both* agents have. Tools.md §III.2.
export const SET_PAGE_BACKGROUND: ToolDeclaration = {
  name: "set_page_background",
  description: `Paint one page of a board a colour, or take its colour off. This is how "make that page black", "give it a warm background", "put it back on white" are done, and it is the only way a page gets a ground: a page's colour is the page's own, so it is never a rectangle placed on top of one — a rectangle you draw is an object that can be moved, restacked and picked up by accident, and this is not. It costs nothing and makes no model call. Nothing on the page moves and nothing is taken off: the ground goes behind everything already standing there, which is worth thinking about before you paint, because near-black lettering on a page painted near-black is a page that looks emptied without anything having left it. Read the board with read_canvas first — pages are told apart by an id, the wrong page is somebody else's work, and each page there says the colour it already stands on. A page already that colour is left alone and said so, and painting a second colour repaints the page rather than stacking one ground on another.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the page is on, by an id from read_canvas.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to paint, by an id from read_canvas. Required: there is no default page, and painting the wrong one is a change to somebody else's work that nothing on the page you meant will show.",
      },
      colour: {
        type: "STRING",
        description: `The colour, as a hex like #0c111c or #f4efe6 — or "${PAGE_BACKGROUND_NONE}" to take the page's ground off and leave it standing on whatever the board itself is. A word for a colour is not a colour here and is refused rather than guessed at.`,
      },
    },
    required: ["boardId", "pageId", "colour"],
  },
};

/// The board's own ground (§XI.3), and the one canvas tool of this set agent 8
/// does not get. Tools.md §III.2.
export const SET_CANVAS_BACKGROUND: ToolDeclaration = {
  name: "set_canvas_background",
  description: `Paint a whole board — the canvas itself, the surface every page on it sits on — a colour, or put it back on plain white. This is how "make that board dark", "put the whole thing on charcoal", "back to white" are done when they mean the board rather than one page of it. It costs nothing and makes no model call, and it moves nothing and takes nothing off: the canvas is behind everything, so photographs, type and pages all stay exactly where they are. Use set_page_background instead when they mean one page — a page painted its own colour keeps it, and the canvas is then only what shows around and between the pages. Worth saying before you paint: this is what an unpainted page is drawn on, so a board put on near-black is every plain page on it going near-black too, and near-black lettering standing on one disappears without anything having been taken off it. A board already that colour is left alone and said so.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board to paint, by an id from your instructions or list_boards.",
      },
      colour: {
        type: "STRING",
        description: `The colour, as a hex like #0c111c or #f4efe6 — or "${CANVAS_BACKGROUND_DEFAULT}" to put the board back on the white it was made on. A word for a colour is not a colour here and is refused rather than guessed at.`,
      },
    },
    required: ["boardId", "colour"],
  },
};

export const DISCARD_PAGE: ToolDeclaration = {
  name: "discard_page",
  description:
    "Offer to take one page off a board and leave the rest of the board standing. Like discard_board this deletes nothing: it puts that page in front of the user with a Discard button on it, and they decide. What would go is the page and the arrangement on it — the photographs standing on that page come off the board with it, which is what \"drop that page\" means — so say which page and what is on it, and leave the choice with them; never that the page is gone, deleted or removed. Call it when they want a page gone and not the board (\"lose the second page\", \"I don't need the exteriors any more\", \"bin the page you just added\"). Use discard_board instead when they want the whole board. Offer only the page they named — a discard cannot be undone once taken — and read the board first, since a board's pages are told apart by an id and the wrong page is somebody else's work. Taking a page off takes none of its photographs out of the gallery, and a section the user drew inside the page keeps its own pictures.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to offer for discarding, by an id from a pages list inspect_board gave you. Required: there is no default page to throw away.",
      },
    },
    required: ["boardId", "pageId"],
  },
};

/// How many pictures one call may exchange — a legibility ceiling, not a cost
/// one. Tools.md §IV.2.
export const SWAP_LIMIT = 10;

export const SWAP_ON_BOARD: ToolDeclaration = {
  name: "swap_on_board",
  description:
    `Put one picture on a board in the place of another and leave the board otherwise exactly as it is — the replacement takes the place the old one had and nothing else moves. This is how a cut the user has taken goes onto a board in place of the frame it came from. Name a picture the board already holds as putOn and the two trade places instead, which is how "swap those two around" or "put that one where the wide shot is" is done. It costs nothing, it lays nothing out again, and it never touches a picture you did not name, so prefer it over compose_moodboard for any picture-for-picture replacement or for moving pictures around a board they are already on: a rebuild reassigns every slot and gives back an arrangement they did not ask for. At most ${SWAP_LIMIT} exchanges a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the exchange is on, by an id from a pages list inspect_board gave you. Name it whenever the board has more than one page: the same photograph can be on two of them, and without a page the picture taken off is whichever copy the board carries first, which may be on a page the user is not talking about. Both ends are then looked for on that page alone — a picture that is on another page of the board joins this one in the place named rather than trading across the spread — and nothing on the board's other pages moves. Leave it out on a board of one page.",
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

/// How many lines one call may rewrite, on the swap's terms. Tools.md §IV.2.
export const REWORD_LIMIT = 10;

export const REWORD_ON_BOARD: ToolDeclaration = {
  name: "reword_on_board",
  description:
    `Change the words of a line of text on a board and leave the board otherwise exactly as it is — the line keeps its place and every picture stays in the slot it is in. This is how a typo is fixed, a headline is rewritten or a caption is put in different words. It costs nothing and lays nothing out again, so prefer it over compose_moodboard for any change to the wording of a line that is already on the board: a rebuild reassigns every slot and gives back an arrangement they did not ask for. Use compose_moodboard's addCaptions/removeCaptions only to add a line the board does not carry or take one off it. At most ${REWORD_LIMIT} lines a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the line is on, by an id from a pages list inspect_board gave you. Name it whenever the board has more than one page: pages of a spread carry the same words often — a heading in the same place on each — and without a page the line rewritten is whichever copy the board carries first. Nothing on the board's other pages is read or changed. Leave it out on a board of one page.",
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

/// How many pictures one call may carry across, on the same terms.
/// Tools.md §IV.2.
export const MOVE_LIMIT = 10;

export const MOVE_TO_PAGE: ToolDeclaration = {
  name: "move_to_page",
  description:
    `Carry pictures from one page of a board to another page of the same board. They come off the page they were on and join the other one where there is room, at the size that page's own pictures are — so the board holds each of them once when it is done, on the page the user asked for. This is how "put the stairwell on the second page instead", "move the exteriors onto the night page" and "that one belongs on page 1" are done. It costs nothing, it makes no model call and it lays neither page out again, so prefer it over compose_moodboard for moving pictures between pages: a rebuild reassigns every slot on both pages and gives back arrangements they did not ask for. Do not use swap_on_board for it — a swap puts a picture in the place of another one and leaves the copy on the page it came from, so the board ends up carrying it twice. Read the board with inspect_board first: both pages are named by id and the wrong page is somebody else's work. At most ${MOVE_LIMIT} pictures a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      fromPageId: {
        type: "STRING",
        description:
          "The page the pictures are on now, by an id from a pages list inspect_board gave you. Required: a picture is taken off a page, and a picture that is not on this one is not moved — it is named back to you so you can name the page it is really on instead.",
      },
      toPageId: {
        type: "STRING",
        description:
          "The page they are to go on, by an id from the same pages list. Required, and it must be a different page of the same board — to put a picture on a board it is not on at all use compose_moodboard's addReferenceIds, and to make the page it is going to first use add_page.",
      },
      referenceIds: {
        type: "ARRAY",
        description:
          "The pictures to carry across, by id, as inspect_board reported them on the page they are coming off. Nothing else on either page moves.",
        items: { type: "STRING" },
      },
    },
    required: ["boardId", "fromPageId", "toPageId", "referenceIds"],
  },
};

/// How many objects one call may put on a canvas, on the same terms.
/// Tools.md §IV.2.
export const CANVAS_PUT_LIMIT = 10;

/// How many selectors one call may take off a canvas — the asks rather than the
/// elements, since one selector can sweep several. Tools.md §IV.2.
export const CANVAS_REMOVE_LIMIT = 10;

/// How many changes one call may transform, on the same terms. Tools.md §IV.2.
export const CANVAS_TRANSFORM_LIMIT = 10;

/// How many moves one call may reorder, on the same terms.
export const CANVAS_REORDER_LIMIT = 10;

/// How many objects one call may restyle, on the same terms again.
/// Tools.md §IV.2.
export const CANVAS_RESTYLE_LIMIT = 10;

export const READ_CANVAS: ToolDeclaration = {
  name: "read_canvas",
  description:
    "Read where everything on a board is: every picture, line of text (with the colour, size, family and alignment it is set in), shape (a rectangle, ellipse or line, with its own fill and stroke) and page as an object with the handle to grab it by (objectId), its box, its rotation in degrees, its stacking order (z, among its own company — a page's objects, loose objects, pages — 0 at the back), the page holding it, opacity on anything faded below whole, and locked and clipped marks. Anything else drawn on the board — an arrow, a diamond, a freehand stroke, an embed, a label bound to a shape — has no handle and is counted in unaddressable rather than left out silently. Boxes are [ymin, xmin, ymax, xmax], in thousandths of the holding page for an object on one and in scene pixels for pages and for objects loose on the canvas — each object says which in boxUnit. It costs nothing, changes nothing and shows nothing; it is not inspect_board, which answers what a board holds and how it stands as composed — this answers where each thing is and by what handle. Read it before transform_on_canvas, restyle_on_canvas, reorder_on_canvas or remove_from_canvas, the way inspect_board is read before a content edit: every objectId those tools take comes from here, and a referenceId is not a handle — the same photo placed twice is two objects.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "One page of that board, by an id from a pages list inspect_board gave you or a page object this tool read — leave it out to read the whole board. Naming a page reads the objects standing on that page alone.",
      },
    },
    required: ["boardId"],
  },
};

export const PUT_ON_CANVAS: ToolDeclaration = {
  name: "put_on_canvas",
  description:
    `Put objects onto a board one by one: a picture by its reference id, a line of text, a shape (a rectangle, an ellipse or a line), or an empty page, each at an optional box. This is the tool for when the user says where something goes — "put the stairwell in the top right", "a caption under that one", "an empty page after this" — because a box here lands exactly there, while compose_moodboard decides places for you; prefer compose_moodboard when they want a set arranged and this when they name the thing and the place. A box is [ymin, xmin, ymax, xmax] as read_canvas speaks it: thousandths of the page when the object names a pageId, scene pixels when it does not. A picture keeps its own shape inside the box rather than stretching to it, and one the target page or board already carries is not doubled — it is answered back as alreadyOn. Left without a box, the object is placed into free room by the same rules compose_moodboard's edit-in-place path uses, and nothing already on the board moves either way — except a shape, which always names its box, since there is a house rule for where a photograph and a headline go and none for where a colour field goes. A shape is exactly its box and may be flat: a rule is a line with the same ymin and ymax. The style fields below land with the object; one asked of a kind it does not apply to — a fill on a line of text — is refused with the reason rather than dropped. At most ${CANVAS_PUT_LIMIT} objects a call — the surplus is reported back, so call again with them rather than telling the user they were placed.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      objects: {
        type: "ARRAY",
        description:
          "The objects to put on, in the order they should land. Each names its kind and the field that kind needs: an image needs referenceId, text needs text, a page takes an optional name.",
        items: {
          type: "OBJECT",
          properties: {
            kind: {
              type: "STRING",
              description: "What this object is: a picture, a line of text, a shape, or an empty page.",
              enum: ["image", "text", "shape", "page"],
            },
            referenceId: {
              type: "STRING",
              description:
                "For an image: the picture to put on, by an id from the list in your instructions or list_references.",
            },
            text: {
              type: "STRING",
              description: "For text: the words to set, as they should read on the board.",
            },
            name: {
              type: "STRING",
              description:
                "For a page: what to call it, when the user said. Left out it is called Page N past the pages the board already carries.",
            },
            pageId: {
              type: "STRING",
              description:
                "The page an image or a line goes on, by an id from read_canvas or inspect_board. With it the box is in thousandths of that page; without it the object goes loose on the canvas and the box is scene pixels. A page being put cannot itself name one.",
            },
            box: {
              type: "ARRAY",
              description:
                "Where exactly it goes: [ymin, xmin, ymax, xmax], thousandths of the named page or scene pixels without one. A box may go outside 0–1000, and a picture put past the page's edge is drawn cut off there — so a picture that has to cover a page it is not the shape of goes on at a box big enough to bleed off both edges. Leave it out to have a place found — free room beside what is there, never on top of it.",
              items: { type: "NUMBER" },
            },
            shape: {
              type: "STRING",
              description:
                "For a shape: which one. A rectangle or an ellipse is a colour field, a scrim over a photograph or a border; a line is a rule.",
              enum: ["rectangle", "ellipse", "line"],
            },
            fill: {
              type: "STRING",
              description:
                "A shape's inside, as a hex colour or transparent. A fill asked for with no stroke lands with no outline — a colour field rather than a box.",
            },
            stroke: {
              type: "STRING",
              description: "A shape's outline, as a hex colour or transparent.",
            },
            strokeWidth: {
              type: "NUMBER",
              description: `A shape's outline in scene units, over 0 and up to ${CANVAS_STROKE_MAX}. 1 is thin.`,
            },
            strokeStyle: {
              type: "STRING",
              description: "A shape's outline: solid, dashed or dotted.",
              enum: ["solid", "dashed", "dotted"],
            },
            rounded: {
              type: "BOOLEAN",
              description:
                "True for a shape or a picture with rounded corners; left out, they are square.",
            },
            colour: {
              type: "STRING",
              description:
                "For text: the ink, as a hex colour. Left out it is near-black, and near-black type over a dark photograph is type nobody can read.",
            },
            font: {
              type: "STRING",
              description:
                "For text: the family. hand is excalidraw's own hand-drawn one and is what a line lands in when this is left out; sans is neutral, mono is for data and captions, rounded is soft, display is heavy — for a headline that has to carry a page.",
              enum: FONT_NAMES,
            },
            align: {
              type: "STRING",
              description: "For text: where the words sit in their box — left, center or right.",
              enum: ["left", "center", "right"],
            },
            fontSize: {
              type: "NUMBER",
              description: `For text: the size in scene units, ${LAYOUT_TEXT_MIN_FONT} through ${CANVAS_TEXT_MAX_FONT}. Said, it is the size set. Left out, the size follows the box height and is capped at ${LAYOUT_TEXT_MAX_FONT} — so a headline meant to fill a page says the number.`,
            },
            opacity: {
              type: "NUMBER",
              description:
                "0 through 100, on a shape, a line of text or a picture; 100 is solid. A photograph at 40% is a scrim with nothing added to the page.",
            },
          },
          required: ["kind"],
        },
      },
    },
    required: ["boardId", "objects"],
  },
};

export const REMOVE_FROM_CANVAS: ToolDeclaration = {
  name: "remove_from_canvas",
  description:
    `Take objects off a board and leave everything else exactly where it is. Each selector is tried as an objectId from read_canvas first — the one sure handle, since the same photo placed twice is two objects — then as a referenceId, which takes every copy of that picture off the board, then as the words of a line of text as the board carries them. A page's id takes that page off with the arrangement standing on it, which is the same act discard_page offers with a button — so offer the discard when the user is deciding and use this only when they have already said out loud that it goes. Nothing leaves the project: a picture taken off a board is still in the gallery, and putting it back is one put_on_canvas call. Locked objects are refused rather than removed, and a selector that matches nothing on the board is named back as notOnBoard, never dropped silently. At most ${CANVAS_REMOVE_LIMIT} selectors a call — the surplus is reported back, so call again with them.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      objects: {
        type: "ARRAY",
        description:
          "What to take off: objectIds from read_canvas, or a referenceId to take every copy of a picture, or a line's words quoted as the board carries them, or a pageId to take a page and what is on it.",
        items: { type: "STRING" },
      },
    },
    required: ["boardId", "objects"],
  },
};

export const TRANSFORM_ON_CANVAS: ToolDeclaration = {
  name: "transform_on_canvas",
  description:
    `Move, rotate and resize objects on a board, several changes in one call, and leave everything you did not name exactly where it is. This is how "move it 200 left", "turn that a little", "make it bigger" are done — prefer it over compose_moodboard for any change that is pure geometry, because a rebuild reassigns every slot and gives back an arrangement they did not ask for. Read the board with read_canvas first: a change is written against the box that read reported, in the same dialect — thousandths of the holding page, scene pixels for pages and loose objects. The rules it keeps: a page cannot be rotated and its shape is resize_page's to change — both are refused with the reason, never silently skipped; a locked object, or any group with a locked member, is refused; a grouped object moves its whole group rigidly, so name one member and the group follows; a picture keeps its own proportions when resized unless the change says stretch, text resizes by its type size, and a shape takes the size asked exactly because a colour block has no proportions to keep; moving a page carries everything standing on it. A change asking for what is already true writes nothing. At most ${CANVAS_TRANSFORM_LIMIT} changes a call — the surplus is reported back, so call again with them.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      changes: {
        type: "ARRAY",
        description:
          "The changes to make, each naming one object and any of a new place, a new angle and a new size — one object once per call.",
        items: {
          type: "OBJECT",
          properties: {
            objectId: {
              type: "STRING",
              description: "The object to change, by its handle from read_canvas.",
            },
            to: {
              type: "ARRAY",
              description:
                "Where its top-left corner goes: [ymin, xmin] in the dialect its read box was in — thousandths of its page, scene pixels for a page or a loose object.",
              items: { type: "NUMBER" },
            },
            angle: {
              type: "NUMBER",
              description:
                "The absolute rotation to stand it at, in degrees clockwise as read_canvas reports it — not a delta. 0 stands it straight. Pages cannot rotate.",
            },
            size: {
              type: "ARRAY",
              description:
                "The extent to give it: [height, width] in the same dialect as to. A picture keeps its proportions inside it unless stretch is set; text scales its type size to fit; a shape takes it exactly.",
              items: { type: "NUMBER" },
            },
            stretch: {
              type: "BOOLEAN",
              description:
                "Stretch a lone picture to exactly size instead of keeping its proportions — only when the user asked for the distortion, since a photo forced to a shape is usually a crop_reference ask in disguise.",
            },
          },
          required: ["objectId"],
        },
      },
    },
    required: ["boardId", "changes"],
  },
};

export const RESTYLE_ON_CANVAS: ToolDeclaration = {
  name: "restyle_on_canvas",
  description:
    `Change how objects on a board look and move nothing: a shape's fill, outline and corners, a line of text's ink, family, alignment and size, a picture's corners, and the opacity of any of them. This is how "make that block navy", "set the names in the heavy face", "drop the photo back so the type reads" are done. Read the board with read_canvas first — every objectId comes from there, and it reports each shape's fill, stroke and opacity so you can see what you are changing. Each field belongs to a kind: fill, stroke, strokeWidth and strokeStyle are a shape's, rounded is a shape's or a picture's, colour, font, align and fontSize are a line of text's, and opacity is a shape's, a line's or a picture's. A field asked of the wrong kind is refused with the reason and the rest of that change is still made, so nothing is dropped silently. A page takes none of them, a locked object is refused, and a field already set to what you asked writes nothing. Prefer this over taking an object off and putting it back: the object keeps its place, its size and its stacking. At most ${CANVAS_RESTYLE_LIMIT} objects a call — the surplus is reported back, so call again with them.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      changes: {
        type: "ARRAY",
        description:
          "The objects to restyle, each naming one object and the fields to set on it — one object once per call.",
        items: {
          type: "OBJECT",
          properties: {
            objectId: {
              type: "STRING",
              description: "The object to restyle, by its handle from read_canvas.",
            },
            fill: {
              type: "STRING",
              description:
                "A shape's inside, as a hex colour or transparent — transparent leaves an outline with the page showing through it.",
            },
            stroke: {
              type: "STRING",
              description:
                "A shape's outline, as a hex colour or transparent — transparent on a filled shape leaves a colour field with no box drawn round it.",
            },
            strokeWidth: {
              type: "NUMBER",
              description: `A shape's outline in scene units, over 0 and up to ${CANVAS_STROKE_MAX}. 1 is thin.`,
            },
            strokeStyle: {
              type: "STRING",
              description: "A shape's outline: solid, dashed or dotted.",
              enum: ["solid", "dashed", "dotted"],
            },
            rounded: {
              type: "BOOLEAN",
              description:
                "True for a shape or a picture with rounded corners, false for square ones.",
            },
            colour: {
              type: "STRING",
              description:
                "For text: the ink, as a hex colour. Near-black type over a dark photograph is type nobody can read.",
            },
            font: {
              type: "STRING",
              description:
                "For text: the family. hand is excalidraw's own hand-drawn one and is what a line lands in unless it was placed with another; sans is neutral, mono is for data and captions, rounded is soft, display is heavy — for a headline that has to carry a page.",
              enum: FONT_NAMES,
            },
            align: {
              type: "STRING",
              description: "For text: where the words sit in their box — left, center or right.",
              enum: ["left", "center", "right"],
            },
            fontSize: {
              type: "NUMBER",
              description: `For text: the size in scene units, ${LAYOUT_TEXT_MIN_FONT} through ${CANVAS_TEXT_MAX_FONT}. The line's box follows the size, so this is how a headline is made to carry without moving it.`,
            },
            opacity: {
              type: "NUMBER",
              description:
                "0 through 100, on a shape, a line of text or a picture; 100 is solid. A photograph at 40% is a scrim with nothing added to the page.",
            },
          },
          required: ["objectId"],
        },
      },
    },
    required: ["boardId", "changes"],
  },
};

export const REORDER_ON_CANVAS: ToolDeclaration = {
  name: "reorder_on_canvas",
  description:
    `Change what draws in front of what on a board, and move nothing: each move sends one object to the front or the back of its own company, or to just above or just below another object. This is how "bring that forward", "put the caption on top", "tuck it behind the wide shot" are done — prefer it over compose_moodboard for stacking, because a rebuild reassigns every slot. Read the board with read_canvas first: the z it reports is stacking among the object's own company — a page's objects against that page's, loose objects against loose, 0 at the back — and front/back mean the front and back of that company, so an object on a page cannot be sent above one on another page; above/below take an objectId of the same company. Moves apply in the order given, each against the board the one before left. A grouped object moves its whole group as one block, a page cannot be reordered (pages do not stack — refused with the reason), locked is refused, and a move asking for what is already true writes nothing. At most ${CANVAS_REORDER_LIMIT} moves a call — the surplus is reported back, so call again with them.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "One page of that board, by an id from read_canvas or inspect_board — with it every move is checked against that page's objects alone, and one standing elsewhere is refused rather than moved. Leave it out to address the whole board.",
      },
      moves: {
        type: "ARRAY",
        description:
          "The moves to make, in order. Each names one object and exactly one destination: to front, to back, above another object, or below one.",
        items: {
          type: "OBJECT",
          properties: {
            objectId: {
              type: "STRING",
              description: "The object to restack, by its handle from read_canvas.",
            },
            to: {
              type: "STRING",
              description:
                "front or back of the object's own company. Leave it out when naming above or below instead — each move takes exactly one of the three.",
              enum: ["front", "back"],
            },
            above: {
              type: "STRING",
              description:
                "Draw it just in front of this object, by its handle — an object of the same company.",
            },
            below: {
              type: "STRING",
              description: "Draw it just behind this object, by its handle — same company.",
            },
          },
          required: ["objectId"],
        },
      },
    },
    required: ["boardId", "moves"],
  },
};

/// The largest declaration in the layer, and eight of its thirteen parameters
/// are about rebuilding a board — the ones gated. Tools.md §III.2.
export function composeMoodboardFor({ crops, boards }: ProjectState): ToolDeclaration {
  const rebuild = boards > 0;
  return {
    name: "compose_moodboard",
    description: `Lay the project's pictures out as a moodboard the user can open and keep working on${
      rebuild ? " — a new board, or a rebuild of one they already have if you pass boardId" : ""
    }. This is the one tool that makes something rather than reads something, so call it when a board is asked for and not to illustrate a point — show_references is for that. Offer between ${LAYOUT_MIN_BLOCKS} and ${COMPOSE_BLOCK_LIMIT} references and expect a selection: past ${LAYOUT_MAX_BLOCKS} the surplus is left off the board.`,
    parameters: {
      type: "OBJECT",
      properties: {
        intention: {
          type: "STRING",
          description:
            "What this board is for, in the user's own words — the look it argues for. Used to compose it and, unless you give a title, to name it.",
        },
        ...(rebuild
          ? {
              boardId: {
                type: "STRING",
                description:
                  "A board to rebuild, by an id from your instructions or list_boards. Leave it out to file a new one. A rebuild replaces what is on that board: leave referenceIds out to lay the pictures it already holds out again, use addReferenceIds/removeReferenceIds to change which of them are on it, and give referenceIds only to replace the selection outright. The lines it carries work the same way: addCaptions/removeCaptions to change them, captions only to replace them.",
              },
              pageId: {
                type: "STRING",
                description:
                  "Which page of that board to lay out, by an id from an inspect_board pages list. A board is one or more pages and this composes one of them: the pictures and lines already on that page are what a rebuild keeps, and the board's other pages are not touched. Leave it out on a board of one page. On a board of several, read it with inspect_board first and name the page the user is talking about — left out there, the first page is the one that gets laid out again. A page the user resized keeps the size they made it — the template is fitted into their rectangle rather than the page being reset to the template's — so a page reported as Custom does not change shape when you name a different template for it. With newPage it means something else: the page the new one goes beside.",
              },
              newPage: {
                type: "BOOLEAN",
                description:
                  "Put this arrangement on a page of its own, added to that board — for “put those on another page”, “a second page for the exteriors”, anything that asks for more board rather than a different one. Nothing already on the board is read, moved or written over: the new page lands clear to the right of it, so referenceIds is the whole of what goes on it and there is nothing to add to or keep. Leave it out to lay out a page the board already has, which is what a rebuild is.",
              },
              pageName: {
                type: "STRING",
                description:
                  "What to call a page. Pages are otherwise called Page 1, Page 2 — pass this whenever the user gave one a name of their own (“a page for the exteriors”, “call that one act two”), because the name is what they and you both say the page by afterwards. With newPage it names the page being added; with pageId it renames that page, and passing boardId, pageId and pageName alone renames it and changes nothing else — nothing on the page moves, it is not laid out again and no other page is touched. A board with no pages has nothing to name: call add_page for that.",
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
                  "On a rebuild: references to put on the board *as well as* the ones it already holds. Use this when the user wants a picture added — you cannot see what is on a board, so naming the whole set instead would drop the pictures you did not name. Nothing already on the board moves: the picture goes into a free place, and only a board with no room left for it is laid out again.",
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
                  "On a rebuild: lines to set on the board *as well as* the ones it already carries. Use this to add a line — you cannot see a board's text unless you read it, so listing captions instead would delete the lines you did not repeat. Nothing already on the board moves: the line is set in a free text block, or above the arrangement on a board the user made themselves.",
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
              ? "Leave it out unless the user asked for a particular shape of board: a rebuild with no template keeps the one the board is already on, and RANDOM would change the shape of a board they only asked you to add a picture to."
              : "Leave it out unless the user asked for a particular shape of board.",
          ].join(" "),
          enum: [...LAYOUT_REQUESTS],
        },
        layoutImageId: {
          type: "STRING",
          description: [
            /// The one argument on this tool whose value is a picture that does
            /// *not* go on the board, so the description leads with what the
            /// picture has to be. A photograph passed here reads as a page of one
            /// enormous placeholder and lays the board out as a single slot.
            "A reference id of a picture of the page itself — placeholder boxes drawn where photographs go and ruled areas where text goes, not a photograph.",
            "The page in that picture becomes the layout: pass it when the user handed in a sketch or a scan of the arrangement they want.",
            "It replaces layout, and naming both is refused — say which of the two they asked for.",
            "The picture is the ask rather than a block, so leave its id out of referenceIds: it is not put on the board.",
          ].join(" "),
        },
        title: {
          type: "STRING",
          description: [
            "What to call the board. A new board defaults to the intention;",
            rebuild
              ? "a rebuilt one keeps the name it already has unless you give one. To rename a board and change nothing else, pass boardId and title alone — that renames it and leaves the arrangement exactly as it is."
              : "give one when the user named it.",
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

/// Agent 8's door (compositor-v2.md §VI): one page of one board, laid out by
/// judgement rather than by a template. The routing rule is in the description
/// rather than here because it is the decision the whole design rests on.
/// Tools.md §III.2.
export function designPageFor({ photographs, crops }: ProjectState): ToolDeclaration {
  const pictures = photographs + crops;
  return {
    name: "design_page",
    description: [
      "Hand one page of a board to the designer and get a page back that was arranged by judgement rather than fitted to a template. It reads the board, chooses from the project's pictures, draws and crops what it needs, and puts everything where it decides — any size, any position, no slots.",
      "It is the most expensive tool you have by an order of magnitude — its own model, looking at the page it is making, over several rounds — so call it for the page they actually asked for. It answers with a closing line of its own, which is yours to say to the user in fewer words rather than to quote.",
      "Call it rather than compose_moodboard when the user named a kind of thing that is not a moodboard — a sign, a banner, an album spread, a poster, a cover; or when the ask is about arrangement in words a template cannot answer (“make the headline sit over the top third”, “give it room to breathe”, “the two portraits should face each other”); or when a page that is already laid out needs judgement rather than reassignment.",
      "compose_moodboard stays the answer for “make me a moodboard of these”, and it stays the cheaper, faster and more predictable one. A grid of nine is not a design problem.",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        boardId: {
          type: "STRING",
          description: "The board to design on, by an id from your instructions or list_boards.",
        },
        intention: {
          type: "STRING",
          description:
            "What the page is for, in the user's own words — the thing they asked for and the look they asked for it in. It is the only part of this call the designer cannot read off the board, so pass what they said rather than a summary of it.",
        },
        pageId: {
          type: "STRING",
          description:
            "Which page of that board to design, by an id from an inspect_board pages list. Leave it out on a board of one page. On a board of several, read it with inspect_board first and name the page the user is talking about — the designer reads the board either way, but a page nobody named is a page it has to choose. With newPage it means something else: the page the new one goes beside.",
        },
        newPage: {
          type: "BOOLEAN",
          description:
            "Design onto a fresh page added to that board instead of onto one it already has — for “try another version”, “a poster for the exteriors as well”, anything that asks for more board rather than a different page. Nothing already on the board is moved or written over, so a page that works costs nothing to keep.",
        },
        ...(pictures > 0
          ? {
              imageIds: {
                type: "ARRAY",
                description: `Pictures the user named, by ids from ${idsFrom(crops)}. Pass only the ones they actually pointed at: the designer can see the whole gallery and chooses for itself, and a list you assembled for it is a decision taken away from the one tool here that is paid to make it. Ids this project has not got are reported back rather than refused.`,
                items: { type: "STRING" },
              },
            }
          : {}),
      },
      required: ["boardId", "intention"],
    },
  };
}

export const DESIGN_PAGE = designPageFor(EVERYTHING);

/// How many pictures one turn of the conversation may buy. Two rather than one
/// so a first answer the user rejects can be re-asked in the same turn.
/// Tools.md §IV.1.
export const GENERATE_CALL_LIMIT = 2;

/// What the turn's last generation is refused with, said in terms of what is
/// actually in the project rather than of what was paid for — the ceiling counts
/// calls, not pictures. Tools.md §IV.3.
export function generationCeilingSaid(asked: number, filed: number) {
  const attempts = `${asked} ${asked === 1 ? "picture" : "pictures"}`;
  if (filed <= 0)
    return `you have asked for ${attempts} this turn and none of them could be drawn — tell the user what went wrong rather than asking for another`;
  if (filed < asked)
    return `you have asked for ${attempts} this turn and ${filed} of them ${filed === 1 ? "was" : "were"} drawn — show the user what you did draw and ask whether it is right, rather than drawing another`;
  return `you have already made ${attempts} this turn — show the user what you drew and ask whether it is right, rather than drawing another`;
}

/// The one tool declared on a project with nothing in it (§IV). Ungated, but not
/// stateless: which tool places the id it answers with is a function of what the
/// project holds. Tools.md §III.2.
export function generateImageFor({
  photographs,
  crops,
  boards,
  generated = 0,
}: ProjectState): ToolDeclaration {
  const pictures = photographs + crops;
  const theirs = pictures - generated;
  return {
    name: "generate_image",
    description: [
      "Make a picture that is not in the project and file it as a reference. This is for the ask no upload answers — a paper texture, a dusk gradient, a wash or a colour field to stand behind a composed page, a plain backdrop — and it is the only tool here that makes a picture rather than reading, cutting or arranging one.",
      /// Said only where there is something to prefer, the way the instruction's
      /// own copy of this is (`GENERATING_OVER_THEIRS`). On the empty project it
      /// is a false premise read at the moment of the call: the one tool that
      /// works before anything has been uploaded would be told to look first at
      /// a gallery that is not there.
      ///
      /// The project that drew its way out of empty is the same premise one step
      /// on — it has pictures and none of them are theirs — so the steer is kept
      /// and its reason replaced: what makes a second drawing the wrong answer
      /// there is its price and the fact that it comes back different.
      pictures > 0
        ? theirs > 0
          ? "Prefer a picture the user actually has: a photograph that fits is a photograph somebody chose, and a generated one is only better when nothing in the project is what they asked for."
          : "Look at what you have already drawn first: every picture in this project came from this tool, and asking for the same thing again costs the most of any call here and comes back a different picture."
        : "",
      "What comes back is an ordinary reference with an id, and the analyzer reads it like any upload.",
      /// Which door the id goes through next, said only where that door is open
      /// — a description naming a tool this project was not given is a call the
      /// model will try to make.
      boards > 0
        ? "put_on_canvas places it where the user said and compose_moodboard arranges it with the rest, both on the next round of this same turn."
        : pictures > 0
          ? "compose_moodboard can build a board around it on the next round of this same turn."
          : "The tools that list and arrange pictures arrive with it, on the next round of this same turn.",
      `One picture per call and at most ${GENERATE_CALL_LIMIT} a turn.`,
      "Say in your reply that the picture was made rather than found.",
    ]
      .filter(Boolean)
      .join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        description: {
          type: "STRING",
          description:
            "What the picture should show, written out: the subject, the light, the colour, the mood and the style, carrying what the user asked for and what the brief says the project looks like. Nothing else is sent — the model drawing this cannot see the project, the board or the conversation, so a line that only makes sense beside them makes no sense to it.",
        },
        aspect: {
          type: "STRING",
          description: [
            `The shape to draw it at${pictures > 0 ? ", said the two ways crop_reference says one" : ""}. A *format* is a ratio, width:height — ${CROP_ASPECT_IDS.join(", ")} are the usual ones, and any ratio the user names is asked for as said. A *loose* shape is one of ${LOOSE_SHAPE_IDS.join(", ")}, for when they described a shape without naming a number.`,
            boards > 0
              ? "Pass the shape of the page or the slot the picture is for whenever it is being made for one, since a background drawn square and stretched across a landscape page is a background nobody can use."
              : "Pass the shape the picture has to fill whenever it is being made for one, since the shape is the one thing about a background that cannot be fixed afterwards.",
            "Leave it out only when the shape genuinely does not matter, since the drawing model then picks one.",
          ].join(" "),
        },
      },
      required: ["description"],
    },
  };
}

export const GENERATE_IMAGE = generateImageFor(EVERYTHING);

/// What the project has, in the three counts that decide which tools are worth
/// declaring. Read off the same query that primes the turn, so it costs nothing.
/// Tools.md §III.
export type ProjectState = {
  photographs: number;
  crops: number;
  boards: number;
  /// How many of those pictures this assistant drew rather than the user
  /// bringing them. It gates nothing — a drawn picture is shown, cut and
  /// composed like any other — and is read only by the sentences that tell the
  /// model to prefer what the project already holds, which say something false
  /// on a project holding nothing but its own drawings. Optional on the same
  /// terms as `origin` is on a reference: a caller that has not counted them is
  /// not claiming there are none.
  generated?: number;
};

/// The tools this project can actually use, rather than every tool that exists.
/// Declarations are the one input paid on *every round of every turn*, so the
/// set is a function of what the project holds — and the same counts then decide
/// what the surviving declarations *say*. Tools.md §III.
///
/// Order is fixed rather than derived, so two turns of one conversation hand the
/// model the same tools in the same order.
export function orchestratorTools(state: ProjectState) {
  const { photographs, crops, boards } = state;
  const pictures = photographs + crops;
  return [
    ...(pictures > 0
      ? [
          LIST_REFERENCES,
          showReferencesFor(state),
          cropReferenceFor(state),
          discardReferenceFor(state),
          READ_REFERENCES,
        ]
      : []),
    ...(boards > 0
      ? [
          /// Finding a board, before reading one: the priming names one board
          /// now, so these two are where the ids the fifteen below take come
          /// from. Both read the digest columns only — neither is worth what
          /// `inspect_board` costs when the question is which board.
          LIST_BOARDS,
          GET_BOARD_BRIEF,
          INSPECT_BOARD,
          ADD_PAGE,
          DUPLICATE_PAGE,
          RESIZE_PAGE,
          DUPLICATE_BOARD,
          SWAP_ON_BOARD,
          REWORD_ON_BOARD,
          MOVE_TO_PAGE,
          /// A page's ground (§XI.4), gated with the page tools above it rather
          /// than on a pages count: `ProjectState` carries no such count, and
          /// every other page tool here is on the boards gate for the plain
          /// reason that a page id can only come from a board.
          SET_PAGE_BACKGROUND,
          /// The desk the pages sit on (§XI.3), beside the page's own ground
          /// because the pair is one decision: which of the two a sentence means
          /// is the only thing the model has to get right, and two adjacent
          /// declarations is where it reads that. Agent 6's alone — it is the
          /// board a user is looking at, and `designerTools` does not carry it.
          SET_CANVAS_BACKGROUND,
          /// The canvas six (canvas.md §XI): every one addresses objects by
          /// handles only read_canvas surfaces, and every handle is a board's,
          /// so the gate is the boards count the other board tools are on.
          READ_CANVAS,
          PUT_ON_CANVAS,
          REMOVE_FROM_CANVAS,
          TRANSFORM_ON_CANVAS,
          REORDER_ON_CANVAS,
          RESTYLE_ON_CANVAS,
          DISCARD_PAGE,
          DISCARD_BOARD,
        ]
      : []),
    ...(pictures > 0 ? [composeMoodboardFor(state)] : []),
    /// Beside the compose rather than up in the boards block, because the two
    /// of them are one decision (§VI) and a routing rule reads better next to
    /// the tool it routes away from. Gated on the boards for the plainer reason
    /// every board tool is: it takes a board id and there is nowhere else for
    /// one to come from — a page is designed *onto* a board, and making the
    /// first board is still `compose_moodboard`'s job.
    ...(boards > 0 ? [designPageFor(state)] : []),
    /// Ungated, and the one exception to the paragraph above (§IV): it takes no
    /// id, so there is nothing this project could be missing that would make the
    /// call impossible — and on the empty project it is the only tool that can
    /// be answered at all. A user talking about the look before they have
    /// uploaded is exactly who it is for.
    generateImageFor(state),
  ];
}

/// A reference as the database holds it, in the columns a tool needs — the
/// loosest shape that answers them. Tools.md §V.1.
export type ToolReference = {
  id: string;
  title: string;
  width?: number | null;
  height?: number | null;
  editIntent?: string | null;
  editAspect?: string | null;
  thumbUrl: string;
  /// The star the user put on it in the gallery. Optional because a caller
  /// that has not read the column leaves it off, and an unmarked line then reads
  /// exactly as it always did.
  favorite?: boolean | null;
  source?: { id: string; title: string } | null;
  /// Where the bytes came from, read only to mark the pictures this assistant
  /// drew. Optional for the reason `favorite` is: a caller that has not read
  /// the column is not claiming the picture was shot.
  origin?: ReferenceOrigin | null;
  /// The description a drawn picture was made from. Optional on the same terms
  /// as `origin`, and absent on every picture nobody drew.
  generationPrompt?: string | null;
  analysis?: Partial<AnalysisProperties> | null;
  /// Set only when there is no analysis to read and the reason is known. The
  /// toolset fills it from the project's analyzer runs; a caller that has not
  /// asked leaves it off, and a line with no tags then reads as it always did.
  unread?: UnreadReason | null;
};

/// One reference as the model reads it, every field earning its tokens. The
/// bytes are never in here — an agent that needs to *look* at a picture is given
/// its `gs://` uri as a file part, not a JSON field. Tools.md §V.1.
export type ReferenceDigest = {
  id: string;
  title: string;
  shape: string;
  /// True or absent, never false: an unstarred picture is the ordinary case and
  /// `favorite: false` on twenty-three lines is the tokens of a fact nobody
  /// needed. Present, it is the user's own judgement of the set — the only
  /// one in a digest that was not read off the pixels.
  favorite?: true;
  croppedFrom?: string;
  /// True or absent, never false, on the same terms as `favorite`: a picture
  /// this assistant drew is the rare line, and marking every photograph as one
  /// nobody drew is the tokens of the ordinary case.
  ///
  /// Earned rather than decorative — the instruction is to prefer a picture the
  /// user has over drawing another one, and without this the catalog reads a
  /// backdrop the model invented an hour ago as a photograph they shot.
  made?: true;
  keeps?: string;
  tags?: string[];
  /// Present only when the tags are missing *and* the reason is known, so the
  /// two silences a blank line used to carry — not read, and read with nothing
  /// found — are told apart wherever a digest goes.
  unread?: UnreadReason;
};

/// The shape of a picture, by the name a user would use for it, falling back to
/// the ratio itself. Tools.md §V.1.
export function aspectLabel(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  return cropShapeAt(width / height)?.label ?? `${(width / height).toFixed(2)}:1`;
}

/// The tags of one reference, flattened across the dimensions into the one list
/// the model reasons over, with the palette deliberately left out.
/// Tools.md §V.1.
export function digestTags(analysis?: Partial<AnalysisProperties> | null) {
  if (!analysis) return undefined;
  const tags = ANALYSIS_DIMENSIONS.flatMap(({ key }) => analysis[key] ?? []).map(tagLabel);
  return tags.length ? tags : undefined;
}

/// What a drawn picture was asked for, or nothing at all. Read off the column
/// and not off `origin`, and blank reads as absent. Tools.md §V.1.
export function drawnFrom(reference: ToolReference) {
  const asked = (reference.generationPrompt ?? "").trim();
  return asked || undefined;
}

export function referenceDigest(reference: ToolReference): ReferenceDigest {
  const keeps = (reference.editIntent ?? "").trim();
  const tags = digestTags(reference.analysis);
  return {
    id: reference.id,
    /// Agent 2's name first, the row's second. The row's is the filename the
    /// browser sent, which names a file on somebody's laptop rather than
    /// anything in the frame, so a name read off the picture beats it wherever
    /// there is one. `Untitled` is only for a picture nobody has read that was
    /// also uploaded without a name.
    title: (reference.analysis?.title ?? "").trim() || reference.title.trim() || "Untitled",
    shape: aspectLabel(reference.width, reference.height),
    ...(reference.favorite && { favorite: true as const }),
    ...(reference.source && { croppedFrom: reference.source.id }),
    ...(reference.origin === ReferenceOrigin.GENERATED && { made: true as const }),
    ...(keeps && { keeps }),
    ...(tags && { tags }),
    /// Never beside tags. A reference that has tags has been read, and marking
    /// it would be contradicting the evidence on the same line.
    ...(!tags && reference.unread && { unread: reference.unread }),
  };
}

/// One reference with the whole of its analysis, which is what `read_references`
/// answers with and the one place in the layer the palette and the rationale can
/// be reached. Tools.md §V.2.
export type ReferenceProperties = Omit<ReferenceDigest, "tags" | "unread"> &
  /// Under the dimension names agent 2 wrote them in, because the question this
  /// is called for is "what is the light like" and a flat list makes the model
  /// guess which of the words are about light.
  Record<TagDimension, string[]> & {
    palette: string[];
    /// Agent 2's own sentences about the look — the one field in the analysis
    /// written for a reader rather than for a group-by, and the reason the tool
    /// is worth a round at all.
    rationale: string;
    /// The description this picture was drawn from, on the pictures that were
    /// drawn. Beside the analysis rather than instead of it: the two say
    /// different things — one is what was asked for and the other is what came
    /// out — and a variant of a picture is asked for from the first.
    drawnFrom?: string;
  };

/// Null for a reference with no analysis, which is the caller's filter.
/// Tools.md §V.2.
export function referenceProperties(reference: ToolReference): ReferenceProperties | null {
  const { analysis } = reference;
  if (!analysis) return null;

  /// Picked off the digest rather than spread from it, since the two fields this
  /// shape does not carry are exactly the two a spread would bring.
  const { id, title, shape, favorite, croppedFrom, made, keeps } = referenceDigest(reference);
  const asked = drawnFrom(reference);
  return {
    id,
    title,
    shape,
    ...(favorite && { favorite }),
    ...(croppedFrom && { croppedFrom }),
    /// Carried across rather than dropped with the tags: the catalog marks a
    /// picture the assistant drew, and a properties answer that left the mark
    /// off would have the same picture reading as a photograph the moment it is
    /// looked at closely.
    ...(made && { made }),
    ...(keeps && { keeps }),
    ...(Object.fromEntries(
      ANALYSIS_DIMENSIONS.map(({ key }) => [key, (analysis[key] ?? []).map(tagLabel)]),
    ) as Record<TagDimension, string[]>),
    palette: analysis.colorPalette ?? [],
    rationale: (analysis.rationale ?? "").trim(),
    ...(asked && { drawnFrom: asked }),
  };
}

/// The catalog answer: what fits, and how much did not. Tools.md §II.2.
export function referenceCatalog(references: readonly ToolReference[], limit = CATALOG_LIMIT) {
  const shown = references.slice(0, Math.max(0, limit));
  return {
    total: references.length,
    shown: shown.length,
    references: shown.map(referenceDigest),
  };
}

/// A picture rendered in the chat beside the reply, and clickable (tech-spec
/// §IV): what it takes to draw it *and* what it takes to walk to it.
/// Tools.md §VI.1.
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
  /// Where the bytes came from, carried for the sentence the *browser* writes
  /// after the Remove button is pressed: by then the row is deleted and the tile
  /// is the only thing left that knows what the picture was. Absent when the
  /// door that built the tile never read the column, which words the removal the
  /// way it always was.
  origin?: ReferenceOrigin | null;
};

/// Which page a board tile's Discard button would take, when it takes a page
/// rather than the board. Set only by `discard_page`; a payload rather than a
/// second flag. Tools.md §VI.1.
export type PageDiscardOffer = { pageId: string; name: string };

/// A board the assistant composed, in the chat. Same two halves as a
/// reference's. Tools.md §VI.1.
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
  /// user asked to *change* would be drawn as a grey bar. They are carried
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
  /// user can end it from here, and one board still has one tile in the
  /// strip however many ways this turn talked about it.
  discard?: true;
  /// Set only by `discard_page`: the button under this tile takes the page the
  /// tile is drawn from rather than the board it is on. Present or absent, and
  /// only ever beside `discard` — a tile with no button has nothing to say about
  /// which page a button would take.
  discardPage?: PageDiscardOffer;
};

export type ChatAttachment = ReferenceAttachment | BoardAttachment;

/// What makes two attachments the same attachment. Tools.md §VI.2.
export function attachmentKey(attachment: ChatAttachment) {
  if (attachment.kind === "board") return `board:${attachment.boardId}`;
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
    ...(reference.origin && { origin: reference.origin }),
  };
}

/// How many of a board's lines a tile shows, and how much of one.
/// Tools.md §IV.2.
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

/// The page a tile is of, said as the user knows it — and said only when it
/// tells them something. Tools.md §VI.1.
function pageCaption({ name, position, of }: { name: string; position: number; of: number }) {
  if (of <= 1) return "";
  const which = `page ${position} of ${of}`;
  return name.trim() ? `“${name.trim()}”, ${which}` : which;
}

/// A composed board, as the chat draws it. The caption is what the board *is*
/// rather than what it is called. Tools.md §VI.1.
export function boardAttachmentOf({
  id,
  title,
  layout,
  page,
  onPage,
  images,
  lines = [],
  thumbUrl,
  preview = null,
  discard = false,
  discardPage,
}: {
  id: string;
  title: string;
  /// The template the board is standing in — passed by the compose that just
  /// laid it out, and by a read of a board still sitting in its slots
  /// (`standsAsComposed`). A board the user has rearranged is no longer the
  /// shape of the template it started as, so it passes none and the page says
  /// what it is instead.
  layout?: LayoutName;
  page?: { width: number; height: number };
  /// Which page of the board this tile is of, when it is of one rather than of
  /// the whole canvas (§V). The user looking at a reply about page 2 of a
  /// spread has to be shown page 2: a tile drawn from the whole board says the
  /// reply is about all of it, and on a board of four pages the picture the
  /// sentence is about is a quarter of the miniature.
  onPage?: { name: string; position: number; of: number };
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
  /// The page the offer takes, when the offer is `discard_page`'s. Passed with
  /// `discard`, never instead of it: it says what the button does rather than
  /// whether there is one.
  discardPage?: PageDiscardOffer;
}): BoardAttachment {
  const shape = layout ? layoutLabel(layout) : page ? `${page.width}×${page.height}` : "";
  const said = boardLines(lines);
  const total = said.lines.length + said.linesOver;
  return {
    kind: "board",
    boardId: id,
    title: title.trim() || "Untitled board",
    caption: [
      /// First, because it says what the tile is *of*. The board's own name is
      /// already above it, so what is missing on a spread is which of its pages
      /// the miniature below is.
      onPage ? pageCaption(onPage) : "",
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
    ...(discard && discardPage && { discardPage }),
  };
}

/// What a tool answers with: the JSON the model reads back, and the pictures the
/// user sees, kept separate because they are for different readers.
/// Tools.md §VI.
export type ToolOutcome = {
  result: Record<string, unknown>;
  attachments?: ChatAttachment[];
};

/// Where a click on an attachment lands — which half of the page is showing and
/// which id the panel opens, and nothing else. agent-tools.md; Tools.md §VI.1.
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
      /// user hunting the row the assistant just showed them.
      versionId?: string;
    }
  /// A board opens as a board: the composed scene is the thing to look at, and
  /// the tab row is where it is then renamed, duplicated or thrown away.
  | { view: "moodboard"; boardId: string };

export function attachmentTarget(attachment: ChatAttachment): AttachmentTarget {
  if (attachment.kind === "board") return { view: "moodboard", boardId: attachment.boardId };
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
/// and the ids that answered to nothing — the unknown ones and the ones the
/// limit cut off both reported rather than dropped. agent-tools.md;
/// Tools.md §V.3.
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

/// One conversation's attachments, in arrival order, each picture once. A
/// *board* is the exception: a later view of one replaces the earlier and keeps
/// its place in the strip. Tools.md §VI.2.
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

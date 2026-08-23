import { clampWords, collapsed } from "@/lib/util/text";
import {
  CATALOG_LIMIT,
  UNREAD_MARK,
  referenceCatalog,
  type ReferenceDigest,
  type ToolReference,
} from "@/lib/agent/shared/reference";

/// What agent 6 is told before it is given a single tool: the user's own
/// statement of the project, the pictures in it, and the board they are looking
/// at.
///
/// Priming is paid on every model call of every turn, which is why every line
/// here is a line somebody argued for.

/// How much of the project brief is primed into a turn. Not a readability cap —
/// the column holds 5,000 characters, roughly 1,250 tokens on every model call
/// of every turn. Cut on a word boundary and said out loud.
export const PROJECT_BRIEF_LIMIT = 1200;

/// What the user said this project is, in their own words — the one thing in
/// the priming that nobody and nothing derived, and first in it rather than
/// last.
export function projectBrief({
  title,
  brief,
}: {
  title: string;
  brief?: string | null;
}) {
  const named = title.trim() || "Untitled project";
  const words = collapsed(brief ?? "");

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
/// that has one. Three things the model cannot work out from the text itself.
const PROJECT_BRIEF_NOTE = `That brief is the user's own statement of what this project is for, not anything read off a picture: read what they ask against it when deciding which references matter, how a cut is framed and what a board argues. What they say in this conversation wins where the two disagree. You cannot write or change the brief — it is theirs, edited above the gallery — so say so if it looks out of date rather than working around it.`;

/// The project's photographs, written into the turn instead of fetched by a
/// tool call, as lines rather than as JSON.
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

/// One reference on one line, in the order a user reads it.
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
/// tags, which are a comma list.
const STARRED_MARK = "starred";

/// A picture this assistant drew, in one word, beside the star and for the same
/// reason.
const MADE_MARK = "generated";

/// What the star means, said once and only to a project that has one.
function starredNote(digests: readonly ReferenceDigest[]) {
  const starred = digests.filter((digest) => digest.favorite).length;
  if (!starred) return "";
  return `${starred === 1 ? "The picture" : "The pictures"} marked “${STARRED_MARK}” ${starred === 1 ? "is one" : "are ones"} the user starred in the gallery — their own pick, not anything read off the image. Prefer ${starred === 1 ? "it" : "them"} when choosing what to show or what to put on a board, and give ${starred === 1 ? "it" : "them"} the largest slot unless the user says otherwise. You cannot star or unstar a picture — that is theirs to do.`;
}

/// What the generated mark means, said once and only to a project holding one.
/// The second half is a claim about the rest of the list, so it is read off the
/// list.
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

/// What the marks mean, said once and only when something is marked.
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

/// A board as the model reads it, and never what is *on* it — a board's
/// elements are up to two megabytes of JSON each.
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
  /// How many pages the board is laid out on. Said only when it is more than
  /// one, because a board of one page *is* that page — its size is already on
  /// the line and there is no id to choose between. On a spread it is the one
  /// fact the model cannot get any other way short of a round of inspect_board,
  /// and every page-scoped tool tells it to pass a pageId "on a board of more
  /// than one page" — an instruction it could not act on while nothing said
  /// which boards those are.
  pages?: number;
  /// What those pages are called, in reading order — the name is the user's to
  /// edit, and it is the word they use for the page out loud. Said only on a
  /// spread, for the same reason the count is: on a board of one page the name
  /// is the board's own line said twice.
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
/// rather than every board, and the count is still said on a turn showing no
/// board.
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
/// them, in the round it asked in.
export function boardsList(boards: readonly BoardDigest[]) {
  return boards.map(boardLine);
}

/// One board as the model reads it, everywhere it reads one: the priming's
/// current board, `list_boards`, `get_board_brief`. A board looked up and a
/// board primed have to read identically.
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

/// How many page names one board's line carries.
const PAGE_NAMES_PER_LINE = 6;

/// The pages by name, and only when the names agree with the count — a board
/// saying "3 pages" beside two names would be the model choosing between pages
/// that are not the board's.
function pagesSaid(pages: number, names: readonly string[] | undefined) {
  if (!names || names.length !== pages) return "";

  const shown = names.slice(0, PAGE_NAMES_PER_LINE).map(pageSaid);
  const dropped = names.length - shown.length;
  return `: ${[...shown, ...(dropped ? [`+${dropped} more`] : [])].join(", ")}`;
}

/// A page the user never named is said by its ordinal, unquoted.
function pageSaid(name: string, index: number) {
  return name.trim() ? `“${name.trim()}”` : `page ${index + 1}`;
}

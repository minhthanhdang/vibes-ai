import { clampWords, collapsed } from "@/lib/util/text";
import {
  CATALOG_LIMIT,
  UNREAD_MARK,
  referenceCatalog,
  type ReferenceDigest,
  type ToolReference,
} from "@/lib/agent/shared/reference";

export const PROJECT_BRIEF_LIMIT = 1200;

export function projectBrief({
  title,
  brief,
}: {
  title: string;
  brief?: string | null;
}) {
  const named = title.trim() || "Untitled project";
  const words = collapsed(brief ?? "");

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

const PROJECT_BRIEF_NOTE = `That brief is the user's own statement of what this project is for, not anything read off a picture: read what they ask against it when deciding which references matter, how a cut is framed and what a board argues. What they say in this conversation wins where the two disagree. You cannot write or change the brief — it is theirs, edited above the gallery — so say so if it looks out of date rather than working around it.`;

export function catalogBrief(
  references: readonly ToolReference[],
  {
    crops = 0,
    limit = CATALOG_LIMIT,
  }: { crops?: number; limit?: number } = {},
) {
  const { total, shown, references: digests } = referenceCatalog(references, limit);
  const cuts = crops ? ` ${crops} ${crops === 1 ? "cut has" : "cuts have"} been made of them.` : "";

  if (!total) {
    return `This project has no pictures in it yet — nothing has been uploaded.${cuts}`;
  }

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

const STARRED_MARK = "starred";

const MADE_MARK = "generated";

function starredNote(digests: readonly ReferenceDigest[]) {
  const starred = digests.filter((digest) => digest.favorite).length;
  if (!starred) return "";
  return `${starred === 1 ? "The picture" : "The pictures"} marked “${STARRED_MARK}” ${starred === 1 ? "is one" : "are ones"} the user starred in the gallery — their own pick, not anything read off the image. Prefer ${starred === 1 ? "it" : "them"} when choosing what to show or what to put on a board, and give ${starred === 1 ? "it" : "them"} the largest slot unless the user says otherwise. You cannot star or unstar a picture — that is theirs to do.`;
}

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

function unreadNote(digests: readonly ReferenceDigest[]) {
  const unread = digests.filter((digest) => digest.unread);
  if (!unread.length) return "";

  const pending = unread.some((digest) => digest.unread === "pending");
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

export type BoardDigest = {
  id: string;
  title: string;
  width: number;
  height: number;
  layout?: string | null;
  pages?: number;
  pageNames?: readonly string[];
};

export function currentBoardBrief(board: BoardDigest | null, total: number) {
  if (total <= 0) return "";

  const held = `The project holds ${total} ${total === 1 ? "board" : "boards"}`;
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

export function boardsList(boards: readonly BoardDigest[]) {
  return boards.map(boardLine);
}

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

const PAGE_NAMES_PER_LINE = 6;

function pagesSaid(pages: number, names: readonly string[] | undefined) {
  if (!names || names.length !== pages) return "";

  const shown = names.slice(0, PAGE_NAMES_PER_LINE).map(pageSaid);
  const dropped = names.length - shown.length;
  return `: ${[...shown, ...(dropped ? [`+${dropped} more`] : [])].join(", ")}`;
}

function pageSaid(name: string, index: number) {
  return name.trim() ? `“${name.trim()}”` : `page ${index + 1}`;
}

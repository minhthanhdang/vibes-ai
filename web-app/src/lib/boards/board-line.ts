import { arrangementBounds } from "@/lib/boards/board-place";
import { boardItems, type Rect } from "@/lib/boards/board-contents";
import { DROPPED_IMAGE_GAP } from "@/lib/canvas/moodboard-drop";
import { LAYOUT_TEXT_MAX_FONT, LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// Putting a line of text on a board the user arranged themselves, and taking
/// one off, without laying the board out again.
///
/// `placeOnBoard` is this for pictures and `rewordOnBoard` is the third verb for
/// text — what was left was the first two verbs of text on a hand-arranged board.
/// "Put ACT TWO above those" reached `compose_moodboard` with `addCaptions`, which
/// on a board with no template of its own does not reflow it but *invents* a
/// template from the block count and writes it over an arrangement the user
/// made by hand. A headline is not a reason to lose the board.
///
/// Nothing here is open to judgement. The words are the user's, and a line
/// joining a board they arranged goes where there is room and where a headline
/// goes: above what is already on it, across its width, at the size the board's
/// own text is set in.
///
/// No canvas, no React, no DOM.

/// What the orchestrator is told when a wording it quoted is on no block of the
/// board. Shared by both doors — the rebuild and the in-place edit — because a
/// mis-quoted line is the same mistake whichever path the call took, and two
/// copies of the sentence would drift into two different next steps.
export const LINE_NOT_ON_BOARD_NOTE =
  "that wording is not on the board — read it with inspect_board and quote the line, or ask the user which one they meant";

export type LineResult = {
  elements: SceneElement[];
  /// The lines that joined the board, as they will read on it.
  added: string[];
  removed: string[];
  /// Quoted off a board no text element of which says that: the model is
  /// repeating something the user said rather than something the board says,
  /// and only the user can tell which line they meant.
  notOnBoard: string[];
  alreadyOn: string[];
};

/// A line as it is *matched*, which is not how it is stored: the model reads a
/// board's lines out of `inspect_board` and types one back to say which one it
/// means, so the match has to survive a retyped capital and a doubled space. The
/// same rule `lineSelection` and `rewordOnBoard` match by.
function lineKey(text: string) {
  return words(text).toLowerCase();
}

function words(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/// Excalidraw keeps both strings: `text` is what is drawn after wrapping and
/// `originalText` is what the user typed. A board is read through both, for
/// the same reason `rewordOnBoard` writes both.
function textOf(element: SceneElement) {
  const drawn = typeof element.text === "string" ? element.text : "";
  return drawn || (typeof element.originalText === "string" ? element.originalText : "");
}

function isText(element: SceneElement) {
  return element.type === "text";
}

/// How much of the arrangement's width a line with nothing to copy is set at.
/// Only reached on a board carrying no text at all, and only as a starting size —
/// the user resizes type by dragging it, which is the answer to any guess
/// here being slightly wrong.
const HEADLINE_SHARE = 0.05;

/// The scene with the named lines taken off and the named ones put on.
///
/// Removal is exact in the same sense a picture's is: every text element saying
/// that goes, so a headline the user duplicated leaves once.
///
/// A line joining the board is laid above everything on it, across the width of
/// what is there and centred on it — the place a title goes, and the one place on
/// a hand-arranged board that is reliably empty, since `placeOnBoard` puts joining
/// pictures underneath. Several named at once stack in the order they were given,
/// reading downwards onto the board.
export function placeLinesOnBoard({
  elements,
  page,
  add = [],
  remove = [],
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  /// The rect the lines are set across when there is nothing on the board to
  /// measure — the page's own, corner and all, for a page-scoped edit.
  page: Rect;
  add?: readonly string[];
  remove?: readonly string[];
  makeId?: () => string;
}): LineResult {
  const asked = clean(remove);
  const dropped = new Set(asked.map(lineKey));

  const carried = new Set(elements.filter(isText).map((element) => lineKey(textOf(element))));

  const kept = elements.filter(
    (element) => !(isText(element) && dropped.has(lineKey(textOf(element)))),
  );

  const wanted = clean(add);
  /// A line the board already says is not written on it twice — the same refusal
  /// `placeOnBoard` makes for a picture, and a stronger one here: a line *is* its
  /// words, so two blocks saying the same thing are two things the user
  /// cannot tell apart when they come to point at one.
  const alreadyOn = wanted.filter(
    (line) => carried.has(lineKey(line)) && !dropped.has(lineKey(line)),
  );
  const joining = wanted.filter(
    (line) => !carried.has(lineKey(line)) || dropped.has(lineKey(line)),
  );

  return {
    elements: [...kept, ...set(joining, kept, page, makeId)],
    added: joining,
    removed: asked.filter((line) => carried.has(lineKey(line))),
    notOnBoard: asked.filter((line) => !carried.has(lineKey(line))),
    alreadyOn,
  };
}

/// Normalised, blank dropped, and the same line named twice counted once — the
/// rule `lineSelection` already applies to a rebuild's captions.
function clean(lines: readonly string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const text = words(line);
    if (!text || seen.has(lineKey(text))) continue;
    seen.add(lineKey(text));
    out.push(text);
  }
  return out;
}

function set(
  joining: readonly string[],
  kept: readonly SceneElement[],
  page: Rect,
  makeId: () => string,
): SceneElement[] {
  if (!joining.length) return [];

  const room = arrangementBounds(boardItems(kept), page);
  const fontSize = houseFontSize(kept, room);
  const height = Math.round(fontSize * TEXT_LINE_HEIGHT);
  const stack = height * joining.length + DROPPED_IMAGE_GAP * (joining.length - 1);

  let top = room.y - DROPPED_IMAGE_GAP - stack;
  return joining.map((text) => {
    const y = top;
    top += height + DROPPED_IMAGE_GAP;
    return {
      id: makeId(),
      type: "text",
      x: round(room.x),
      y: round(y),
      /// Across the arrangement rather than around the string, which is what
      /// `autoResize: false` is for: a headline left to size itself shrinks to
      /// its own words and stops reading as one.
      width: round(room.width),
      height,
      text,
      originalText: text,
      fontSize,
      textAlign: "center",
      verticalAlign: "middle",
      autoResize: false,
    } satisfies SceneElement;
  });
}

/// What size the type on this board is, which is what size a new line should be.
/// The median for the same reason `placeOnBoard` takes the median picture edge:
/// one word blown up to a title is a deliberate thing a user does and should
/// not decide the size of every line after it.
function houseFontSize(elements: readonly SceneElement[], room: { width: number }) {
  const sizes = elements
    .filter(isText)
    .map((element) => element.fontSize)
    .filter((size): size is number => typeof size === "number" && Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b);

  const size = sizes.length
    ? sizes[Math.floor((sizes.length - 1) / 2)]!
    : Math.round(room.width * HEADLINE_SHARE);
  return Math.min(LAYOUT_TEXT_MAX_FONT, Math.max(LAYOUT_TEXT_MIN_FONT, Math.round(size)));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

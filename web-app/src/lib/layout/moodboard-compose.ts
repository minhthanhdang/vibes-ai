import {
  LAYOUT_MAX_TEXT_BLOCKS,
  LAYOUTS_WITH_TEXT,
  composeLayoutElements,
  textSlots,
  type LayoutBlock,
  type MoodboardLayout,
  type Placement,
} from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The last step of agent 4: a plan the compositor answered with, turned into a
/// board row's scene.
///
/// This is where the composed board and the dragged one become the same thing.
/// A drop goes through `convertToExcalidrawElements`, which lives in the editor
/// bundle and reaches for `window` — so a board written by an agent, with no tab
/// open and no canvas anywhere, cannot use it. What it can do is emit the few
/// fields that decide how an element *looks* and leave the rest to excalidraw's
/// own `restore`, which fills seeds, versions and fractional indices when the
/// scene is opened. An element is therefore the geometry plus its content, and
/// nothing else is invented here.
///
/// No canvas, no React, no DOM.

/// How many blocks may be offered to one board. Past the largest template the
/// surplus is simply unplaced, so this is a token ceiling rather than a layout
/// one: the compositor choosing nine photographs out of twelve is a selection,
/// choosing nine out of eighty is a catalog read twice.
export const COMPOSE_BLOCK_LIMIT = 12;

/// A text element's box height, as a multiple of its type size. Excalidraw
/// measures text itself the moment it is edited; this only has to be close
/// enough that the block does not overlap what is under it before then.
export const TEXT_LINE_HEIGHT = 1.25;

function elementId(makeId: () => string) {
  const id = makeId();
  return typeof id === "string" && id.length > 0 ? id : crypto.randomUUID();
}

/// The scene a set of placements comes to, in z-order.
///
/// Images first, text after: the scatter and the hero both put their caption
/// over the edge of a photograph, and an array's order is what excalidraw draws
/// last. Within each half the slot order is kept, so the board reads the way the
/// assignment was written.
export function composedScene(
  placements: readonly Placement[],
  { makeId = () => crypto.randomUUID(), origin }: { makeId?: () => string; origin?: { x: number; y: number } } = {},
): SceneElement[] {
  const skeletons = composeLayoutElements(placements, origin);
  const elements = skeletons.map((skeleton) => {
    if (skeleton.type === "text") {
      const { fontSize } = skeleton;
      return {
        id: elementId(makeId),
        ...skeleton,
        height: Math.round(fontSize * TEXT_LINE_HEIGHT),
        /// Excalidraw keeps both: `text` is what is drawn after wrapping,
        /// `originalText` is what the director typed. Written the same so
        /// editing the block does not resurrect a different string.
        originalText: skeleton.text,
        textAlign: "center" as const,
        verticalAlign: "middle" as const,
        /// The slot decides the width. Left to resize itself, a headline set in
        /// a wide block would shrink to the string and stop being a headline.
        autoResize: false,
      };
    }
    return { id: elementId(makeId), ...skeleton };
  });

  return [
    ...elements.filter((element) => element.type === "image"),
    ...elements.filter((element) => element.type !== "image"),
  ];
}

/// What the compositor is offered, out of the references the orchestrator named
/// and the lines it wants set.
///
/// A caption is given an id of its own rather than the slot id it might land in:
/// blocks and slots are two lists the model has to keep apart, and a block
/// called `text-1` in a layout with a slot called `text-1` is an assignment that
/// reads as correct whichever way it was meant.
export function layoutBlocks(
  references: readonly { id: string; width?: number | null; height?: number | null }[],
  captions: readonly string[] = [],
  limit = COMPOSE_BLOCK_LIMIT,
): LayoutBlock[] {
  const images = references.map((reference) => ({
    id: reference.id,
    kind: "image" as const,
    width: reference.width ?? null,
    height: reference.height ?? null,
  }));

  const lines = captions
    .map((caption) => caption.replace(/\s+/g, " ").trim())
    .filter((caption) => caption.length > 0)
    .map((text, index) => ({ id: `caption-${index + 1}`, kind: "text" as const, text }))
    /// The lines are capped by what the templates can *seat*, not by the block
    /// budget. A block budget is a token ceiling and it counts blocks; a slot has
    /// a kind, so a third line is not one twelfth of a board — it is a block no
    /// template on the list has anywhere to put. Left uncapped, ten captions for
    /// ten photographs filled the budget with text and reached the compositor as
    /// two photographs, which is the board nobody asked for.
    .slice(0, LAYOUT_MAX_TEXT_BLOCKS);

  /// Text first when the cap bites: a board missing its ninth photograph is the
  /// board that was asked for, and one missing its title is a board with an
  /// empty block on it. Bounded above by the line cap, so "first" is now at most
  /// two blocks rather than however many lines were named.
  return [...lines, ...images].slice(0, Math.max(0, limit));
}

/// The lines that never reached the compositor, and why. Counted here rather than
/// by the caller because the cap is this module's rule: a caller comparing what it
/// asked for against the blocks it got back would be re-deriving it.
///
/// Said rather than swallowed, for the reason `notOffered` exists for pictures —
/// a director who typed four captions and sees two is owed the sentence, and the
/// two that went on were chosen by the order they said them in rather than by
/// anything the model judged.
export function linesNotOffered(lines: readonly string[], blocks: readonly LayoutBlock[]) {
  const offered = new Set(
    blocks.flatMap((block) => (block.kind === "text" && block.text ? [lineKey(block.text)] : [])),
  );
  return lines.filter((line) => !offered.has(lineKey(line)));
}

/// What the orchestrator does about a line that did not go on. The cap is a
/// property of the templates rather than of the call, so "try again with fewer"
/// is the wrong instruction — there is no board on the list with a third line on
/// it.
export const LINES_NOT_OFFERED_NOTE = `a board holds at most ${LAYOUT_MAX_TEXT_BLOCKS} lines of text, so these were not put on it — tell the director which words did not go on rather than saying the board carries them`;

/// The lines a *template* cannot carry, as against the ones the budget did not
/// offer. Seven of the ten layouts are pictures and nothing else, so a headline
/// composed at one of them reaches the compositor as a block with no slot of its
/// kind and comes back as `unplaced` — which reads as the compositor's judgement
/// rather than as an impossibility, and a headline the director asked for is not
/// something a board gets to leave out on taste.
///
/// Only reachable when the template was *named*: `resolveLayout` seats by kind.
export function linesWithNoSlot(blocks: readonly LayoutBlock[], layout: MoodboardLayout) {
  const room = textSlots(layout).length;
  return blocks
    .filter((block) => block.kind === "text" && block.text)
    .slice(room)
    .map((block) => block.text as string);
}

/// What the orchestrator does about it: the line is not on the board, and the
/// remedy is a template that has somewhere to put it rather than another attempt
/// at the same one.
export function linesWithNoSlotNote(layout: MoodboardLayout) {
  return `${layout.id} has no text block, so these words are not on the board — say that plainly rather than that the board carries them or that the title stands in for them. ${LAYOUTS_WITH_TEXT.join(", ")} carry a line: offer to lay it out at one of those, or leave the template out and let it be chosen.`;
}

/// Which pictures a compose is about, when the director is talking about a board
/// they already have.
///
/// "Put the sunset on it too" and "take the third one off" are edits to a set the
/// model cannot see: the boards are primed by id, title and page size, and their
/// scenes are megabytes each — deliberately never read to prime a turn. So the
/// model names the *change* and the change is applied here, against the board's
/// own scene. Made to name the whole set instead, it would have to guess, and a
/// guess on this path silently drops every picture it forgot.
///
/// What the edit could not do is reported rather than swallowed: an id removed
/// that was never on the board is the model having meant a different picture, and
/// the director is the one who can tell which.
export function boardSelection({
  onBoard = [],
  requested = [],
  add = [],
  remove = [],
}: {
  onBoard?: readonly string[];
  requested?: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
}) {
  const base = [...new Set(requested.length ? requested : onBoard)];
  const dropped = new Set(remove);

  const added = [...new Set(add)].filter((id) => !base.includes(id));
  const selection = [...base, ...added].filter((id) => !dropped.has(id));

  return {
    selection,
    /// The ids that changed the board, as opposed to the ids that were asked
    /// about: an add of a picture already on the board and a remove of one that
    /// was never there are both worth a sentence, and neither is a placement.
    added: added.filter((id) => !dropped.has(id)),
    removed: [...new Set(remove)].filter((id) => base.includes(id) || added.includes(id)),
    notOnBoard: [...new Set(remove)].filter((id) => !base.includes(id) && !added.includes(id)),
    alreadyOn: [...new Set(add)].filter((id) => base.includes(id)),
  };
}

/// A line as it is *matched*, which is not how it is stored: the model reads a
/// board's lines out of `inspect_board` and types one back to say which one it
/// means, so the match has to survive a retyped capital and a doubled space.
function lineKey(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/// Which lines a compose sets, when the director is talking about a board they
/// already have.
///
/// The same edit `boardSelection` makes for pictures, and it exists for the same
/// reason: the boards are primed by id, title and page size, so a rebuild asked
/// for with no captions used to write a board with no text on it — a headline
/// deleted by a request to add a photograph. The lines a board already carries
/// are its own until the model says otherwise.
///
/// Matched on the words rather than on an id, because a line *is* its words —
/// there is nothing else to point at one by.
export function lineSelection({
  onBoard = [],
  requested = [],
  add = [],
  remove = [],
}: {
  onBoard?: readonly string[];
  requested?: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
}) {
  const clean = (lines: readonly string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const text = line.replace(/\s+/g, " ").trim();
      if (!text || seen.has(lineKey(text))) continue;
      seen.add(lineKey(text));
      out.push(text);
    }
    return out;
  };

  const base = clean(requested.length ? requested : onBoard);
  const asked = clean(add);
  const dropped = clean(remove);
  const held = new Set(base.map(lineKey));

  const added = asked.filter((line) => !held.has(lineKey(line)));
  const goes = new Set(dropped.map(lineKey));
  const lines = [...base, ...added].filter((line) => !goes.has(lineKey(line)));

  const kept = new Set([...base, ...added].map(lineKey));
  return {
    lines,
    added: added.filter((line) => !goes.has(lineKey(line))),
    removed: dropped.filter((line) => kept.has(lineKey(line))),
    /// A line asked off a board that never carried it: the model is quoting
    /// something the director said rather than something the board says, and
    /// only the director can tell which line they meant.
    notOnBoard: dropped.filter((line) => !kept.has(lineKey(line))),
    alreadyOn: asked.filter((line) => held.has(lineKey(line))),
  };
}

/// Whether a call about a board they already have asks for nothing but a new
/// name.
///
/// A rename is not a compose. It changes no picture, no line and no template, so
/// there is nothing for the compositor to assign — and paying it anyway buys an
/// arrangement nobody asked for, because the assignment it returns is its own
/// reading of the blocks rather than the one the director has been looking at.
/// The same rule iteration 27 applied to a swap: a rebuild is worth paying for
/// while *which picture goes where* is still open, and a rename never opens it.
///
/// Read off the call rather than off the resolved selection, which always comes
/// back full: a rebuild with no references named means "the ones it already has",
/// so by the time the selection exists a rename and a reshuffle look identical.
export function renamesOnly({
  title = "",
  referenceIds = [],
  addReferenceIds = [],
  removeReferenceIds = [],
  captions = [],
  addCaptions = [],
  removeCaptions = [],
  layout,
}: {
  title?: string;
  referenceIds?: readonly string[];
  addReferenceIds?: readonly string[];
  removeReferenceIds?: readonly string[];
  captions?: readonly string[];
  addCaptions?: readonly string[];
  removeCaptions?: readonly string[];
  /// Whatever the model passed, since a template *request* is a reshape whether
  /// or not it names a template this project has.
  layout?: unknown;
}) {
  if (!title.trim()) return false;
  if (typeof layout === "string" && layout.trim()) return false;
  return [
    referenceIds,
    addReferenceIds,
    removeReferenceIds,
    captions,
    addCaptions,
    removeCaptions,
  ].every((asked) => asked.every((entry) => !entry.trim()));
}

/// Whether a call about a board they already have asks for nothing but something
/// put on it or taken off it — a picture, a line of text, or both.
///
/// It decides, for both kinds of board, that the arrangement is not re-decided.
/// On a board the director arranged by hand a rebuild picks a template from the
/// block count and writes it over what they made, so "put the sunset on that too"
/// and "give it a headline" each cost them the board. On one still standing in its
/// template the pictures already seated keep their slots and only what is joining
/// is composed — see `keptSeats`. What defeats it is a set restated outright or a
/// template named, which are both requests to lay the board out again.
///
/// A title alongside is allowed, because writing it is a column and not a
/// composition. A template named is not: that is a request to lay the board out
/// again, which is exactly what the rebuild does. Read off the call for the same
/// reason `renamesOnly` is — by the time `boardSelection` has run, "the ones it
/// already has" and "these ones" look identical.
export function changesContentsOnly({
  referenceIds = [],
  addReferenceIds = [],
  removeReferenceIds = [],
  captions = [],
  addCaptions = [],
  removeCaptions = [],
  layout,
}: {
  referenceIds?: readonly string[];
  addReferenceIds?: readonly string[];
  removeReferenceIds?: readonly string[];
  captions?: readonly string[];
  addCaptions?: readonly string[];
  removeCaptions?: readonly string[];
  layout?: unknown;
}) {
  if (typeof layout === "string" && layout.trim()) return false;
  const changed = [...addReferenceIds, ...removeReferenceIds, ...addCaptions, ...removeCaptions];
  if (!changed.some((entry) => entry.trim())) return false;
  /// The two arguments that restate a whole set rather than name a change. Either
  /// of them is a replacement, and a replacement of a hand-arranged board's
  /// contents is a composition of a new board on top of it.
  return [referenceIds, captions].every((asked) => asked.every((entry) => !entry.trim()));
}

/// A board tab is a strip in a scrolling row, so its name is read at about this
/// length whatever it is stored at. Shorter than the column allows on purpose:
/// an intention is a sentence and a tab is a label.
export const COMPOSED_TITLE_LIMIT = 60;

/// What to call a board nobody named. The intention is what the director just
/// said they wanted, which is a better name than "Untitled board" and the only
/// one available without asking them a second question.
export function composedBoardTitle(intention: string, fallback = "Composed board") {
  const title = intention.replace(/\s+/g, " ").trim();
  if (!title) return fallback;
  return title.length > COMPOSED_TITLE_LIMIT
    ? `${title.slice(0, COMPOSED_TITLE_LIMIT - 1).trimEnd()}…`
    : title;
}

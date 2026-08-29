import type { Rect } from "@/lib/boards/board-contents";
import { boardPages, pageHolds, type BoardPage } from "@/lib/pages/board-pages";
import { renderFontOf } from "@/lib/render/render-plan";
import { setBlock, setsToItsBox } from "@/lib/render/text-set";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import { collapsed, lineKey } from "@/lib/util/text";

/// One line of text on a board, said differently, and nothing else touched.
///
/// The text counterpart of `swapOnBoard`, and it exists for the same reason. A
/// user fixing a headline — a typo, a different word, the same line in
/// sentence case — was reaching `compose_moodboard` through
/// `addCaptions`/`removeCaptions`, which is a *rebuild*: the compositor is paid to
/// reassign every block and the board comes back with its photographs in
/// different slots. On a board with no template of its own — one the user
/// dragged together — it is worse than a reshuffle, because the rebuild writes a
/// template scene over an arrangement that never had one.
///
/// Nothing here is open to judgement. The words are the user's, the block is
/// the one already carrying them, and the box is the one the board is standing
/// in. So there is no assignment to buy and the whole operation is an edit to one
/// element of the stored scene.
///
/// No canvas, no React, no DOM.

export type RewordRequest = { from: string; to: string };

export type RewordedLine = { from: string; to: string };

export type RewordResult = {
  elements: SceneElement[];
  reworded: RewordedLine[];
  /// A wording no text element on the board carries. Said rather than ignored:
  /// the model is quoting something the user said instead of something the
  /// board says, and only the user can tell which line they meant.
  notOnBoard: string[];
  /// Found, and already said exactly that. A no-op worth naming, because the
  /// reply would otherwise claim a change the board did not make.
  unchanged: string[];
};


/// Excalidraw keeps both strings: `text` is what is drawn after wrapping and
/// `originalText` is what the user typed. A reword that wrote only one of
/// them would be undone the moment the block was opened for editing.
function textOf(element: SceneElement) {
  const drawn = typeof element.text === "string" ? element.text : "";
  return drawn || (typeof element.originalText === "string" ? element.originalText : "");
}

/// Rewrite the words of the text elements carrying `from`, in place.
///
/// The width is deliberately left alone. A composed text block is pinned to its
/// slot's width (`autoResize: false`), so the line the user set is the line the
/// board reads at, and a slot narrowed to its new wording is a layout this door
/// was built not to redo.
///
/// The words inside it are broken to that width and the block stands to what
/// they came to — the same `setBlock` the put and the restyle doors settle,
/// because this is the fourth door onto the same fact. Excalidraw draws `text`
/// exactly as it is stored and wraps nothing until somebody opens the element,
/// so a headline reworded into a sentence was one long line running out of its
/// slot, off the page and through whatever stood beside it.
///
/// `onPage` scopes the match to one page of the board (§V), for the same reason
/// the swap is scoped: a spread's pages carry the same words as often as not —
/// a title block per page, "ACT ONE" and "ACT TWO" in the same template slot —
/// and matched flat, "the heading" is whichever page the array carries first.
export function rewordOnBoard({
  elements,
  rewordings,
  onPage = null,
}: {
  elements: readonly SceneElement[];
  rewordings: readonly RewordRequest[];
  onPage?: BoardPage | null;
}): RewordResult {
  const next = [...elements];
  const reworded: RewordedLine[] = [];
  const notOnBoard: string[] = [];
  const unchanged: string[] = [];

  /// An element may only be reworded once a call. Two pairs naming the same line
  /// out would otherwise both land on the first block carrying it, and the second
  /// would overwrite the first — so the second is reported as what it now is: a
  /// wording the board no longer carries.
  const used = new Set<number>();

  /// By the centre of the block's own box, the rule every page read uses — a
  /// caption dragged off a page is not on it however its `frameId` reads — and
  /// against the board's other pages rather than this rectangle alone, so a line
  /// in the overlap of two pages the user dragged together is reworded on the
  /// one that holds it and not on both.
  const pages = boardPages(elements);
  const onThePage = (element: SceneElement) => {
    if (!onPage) return true;
    const box = rectOf(element);
    return box !== null && pageHolds(pages, onPage, box);
  };

  for (const { from, to } of rewordings) {
    const wanted = lineKey(from);
    const said = collapsed(to);
    if (!wanted || !said) continue;

    const index = next.findIndex(
      (element, at) =>
        !used.has(at) &&
        element.type === "text" &&
        lineKey(textOf(element)) === wanted &&
        onThePage(element),
    );
    if (index < 0) {
      notOnBoard.push(collapsed(from));
      continue;
    }

    const element = next[index]!;
    /// Compared on the words rather than on the key, so "ACT TWO" to "Act two" is
    /// a change: the key ignores case because that is how the model quotes a line
    /// back, not because the board reads the same either way.
    if (collapsed(textOf(element)) === said) {
      used.add(index);
      unchanged.push(said);
      continue;
    }

    next[index] = { ...element, ...saidOn(element, said) };
    used.add(index);
    reworded.push({ from: collapsed(textOf(element)), to: said });
  }

  return { elements: next, reworded, notOnBoard, unchanged };
}

/// The words as the block will carry them: what was said in `originalText`,
/// and in `text` the same words broken to the box.
///
/// A block that sizes itself (`setsToItsBox`) is written the way this door
/// always wrote — one string in both fields, no height touched. Its width is a
/// measurement of the string it used to carry rather than a slot anybody chose,
/// so breaking new words to it would break them to a width nobody decided, and
/// excalidraw grows the box around them the moment it draws them.
function saidOn(element: SceneElement, said: string): Record<string, unknown> {
  const fontSize = finite(element.fontSize);
  const width = finite(element.width);
  if (!setsToItsBox(element) || width === null || fontSize === null || fontSize <= 0) {
    return { text: said, originalText: said };
  }
  const block = setBlock(said, width, fontSize, renderFontOf(element).set);
  return {
    text: block.text || said,
    /// `originalText` is what was said and `text` is what is drawn, so the
    /// breaks go in one and not the other: opening the block re-wraps the
    /// sentence rather than resurrecting this door's guess at where it broke.
    originalText: said,
    height: block.height,
  };
}

function rectOf(element: SceneElement): Rect | null {
  const x = finite(element.x);
  const y = finite(element.y);
  const width = finite(element.width);
  const height = finite(element.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

import type { Rect } from "@/lib/boards/board-contents";
import { boxOnPage } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// One line of text on a board, said differently, and nothing else touched.
///
/// The text counterpart of `swapOnBoard`, and it exists for the same reason. A
/// director fixing a headline — a typo, a different word, the same line in
/// sentence case — was reaching `compose_moodboard` through
/// `addCaptions`/`removeCaptions`, which is a *rebuild*: the compositor is paid to
/// reassign every block and the board comes back with its photographs in
/// different slots. On a board with no template of its own — one the director
/// dragged together — it is worse than a reshuffle, because the rebuild writes a
/// template scene over an arrangement that never had one.
///
/// Nothing here is open to judgement. The words are the director's, the block is
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
  /// the model is quoting something the director said instead of something the
  /// board says, and only the director can tell which line they meant.
  notOnBoard: string[];
  /// Found, and already said exactly that. A no-op worth naming, because the
  /// reply would otherwise claim a change the board did not make.
  unchanged: string[];
};

/// A line as it is *matched*, which is not how it is stored: the model reads a
/// board's lines out of `inspect_board` and types one back to say which one it
/// means, so the match has to survive a retyped capital and a doubled space. The
/// same rule `lineSelection` matches removals by.
function lineKey(text: string) {
  return words(text).toLowerCase();
}

function words(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/// Excalidraw keeps both strings: `text` is what is drawn after wrapping and
/// `originalText` is what the director typed. A reword that wrote only one of
/// them would be undone the moment the block was opened for editing.
function textOf(element: SceneElement) {
  const drawn = typeof element.text === "string" ? element.text : "";
  return drawn || (typeof element.originalText === "string" ? element.originalText : "");
}

/// Rewrite the words of the text elements carrying `from`, in place.
///
/// The box is deliberately left alone. A composed text block is pinned to its
/// slot's width (`autoResize: false`), so the line the director set is the line
/// the board reads at — and the height a compose writes is already an estimate
/// excalidraw replaces the moment the block is edited (`composedScene`). Guessing
/// a new one here without a canvas to measure with would move a block that has no
/// reason to move.
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
  onPage?: Rect | null;
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
  /// caption dragged off a page is not on it however its `frameId` reads.
  const onThePage = (element: SceneElement) => {
    if (!onPage) return true;
    const box = rectOf(element);
    return box !== null && boxOnPage(onPage, box);
  };

  for (const { from, to } of rewordings) {
    const wanted = lineKey(from);
    const said = words(to);
    if (!wanted || !said) continue;

    const index = next.findIndex(
      (element, at) =>
        !used.has(at) &&
        element.type === "text" &&
        lineKey(textOf(element)) === wanted &&
        onThePage(element),
    );
    if (index < 0) {
      notOnBoard.push(words(from));
      continue;
    }

    const element = next[index]!;
    /// Compared on the words rather than on the key, so "ACT TWO" to "Act two" is
    /// a change: the key ignores case because that is how the model quotes a line
    /// back, not because the board reads the same either way.
    if (words(textOf(element)) === said) {
      used.add(index);
      unchanged.push(said);
      continue;
    }

    next[index] = { ...element, text: said, originalText: said };
    used.add(index);
    reworded.push({ from: words(textOf(element)), to: said });
  }

  return { elements: next, reworded, notOnBoard, unchanged };
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

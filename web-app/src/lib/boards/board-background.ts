import { normalizeHexColor } from "@/lib/analysis/analysis";
import { RENDER_BACKGROUND } from "@/lib/render/render-plan";
import { persistedAppState, type PersistedAppState } from "@/lib/scene/moodboard-scene";

/// The board's own ground (canvas.md §XI.3).
///
/// Not an element and deliberately not one: a board is the desk the pages sit
/// on, and a desk drawn as a rectangle would be a rectangle every read has to
/// be told to ignore, every tidy has to be told to skip and every page-sized
/// thing has to be sorted behind. `appState.viewBackgroundColor` is already the
/// field excalidraw paints it from, is already in `PERSISTED_APP_STATE_KEYS`,
/// and `render-plan` already reads it as `plan.background` — so both ends of
/// this exist and only the middle was missing. A page's ground is the opposite
/// decision for the opposite reason and is `lib/pages/page-background`.
///
/// What that costs is that this is the one board write in the app that is not
/// an elements write: `sceneWrite` takes elements and derives the page columns
/// from them, and `appState` is a separate `Json` column that none of §III's
/// conflict story reaches. The revision guard, the keyed queue and the no-op
/// below therefore have to be brought to it deliberately rather than inherited.
///
/// No canvas, no React, no DOM.

/// What "put it back" is said as at the door. Excalidraw opens every board on
/// its own white and the renderer falls back to the same one, so `"default"` is
/// the absence of a stored colour rather than a colour of its own — the key is
/// dropped, and a board that has never been painted is already there.
export const CANVAS_BACKGROUND_DEFAULT = "default";

/// The colour a board is actually drawn on, which is not the same as the colour
/// its row carries: a board with no `viewBackgroundColor` is drawn white, and so
/// is a board carrying `#ffffff`. The no-op is asked against this rather than
/// against the stored value, because the promise is that a repaint moving no
/// pixel writes nothing — and those two rows are the same pixel.
function drawnOn(appState: unknown): string {
  const stored = (appState as { viewBackgroundColor?: unknown } | null | undefined)
    ?.viewBackgroundColor;
  return normalizeHexColor(stored) ?? RENDER_BACKGROUND;
}

/// The colour a board stands on as an answer says it: a hex, or null for a board
/// nobody has painted.
export function canvasBackgroundColour(appState: unknown): string | null {
  const stored = (appState as { viewBackgroundColor?: unknown } | null | undefined)
    ?.viewBackgroundColor;
  return normalizeHexColor(stored);
}

export type CanvasBackgroundEdit = {
  /// The row's `appState` afterwards, or null when the board is already drawn on
  /// the colour asked for — the caller's cue to answer without a write rather
  /// than spend a revision on a repaint that moved no pixel.
  appState: PersistedAppState | null;
  /// The colour the board stands on now, null for excalidraw's own paper.
  colour: string | null;
  was: string | null;
};

/// Paint the board, or put it back on excalidraw's paper. `colour` is a hex or
/// `"default"`; anything else is null, and the caller refuses it in its own
/// answer rather than guessing at a word.
///
/// Allowlisted on the way out, exactly as the tab's own save and `duplicate_board`
/// are: this returns a whole `appState` for a `Json` column, so a row written by
/// an older build is filtered here rather than carried forward one key at a time.
export function setCanvasBackground({
  appState,
  colour,
}: {
  appState: unknown;
  colour: unknown;
}): CanvasBackgroundEdit | null {
  const asked = typeof colour === "string" ? colour.trim() : "";
  const clearing = asked.toLowerCase() === CANVAS_BACKGROUND_DEFAULT;
  const hex = clearing ? null : normalizeHexColor(asked);
  if (!clearing && !hex) return null;

  const was = canvasBackgroundColour(appState);
  if (drawnOn(appState) === (hex ?? RENDER_BACKGROUND)) {
    return { appState: null, colour: clearing ? null : hex, was };
  }

  const next = persistedAppState(appState);
  if (clearing) delete next.viewBackgroundColor;
  else next.viewBackgroundColor = hex!;

  return { appState: next, colour: hex, was };
}

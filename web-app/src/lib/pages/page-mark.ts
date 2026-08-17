import {
  boardPages,
  isPageElement,
  markElementAsPage,
  nextPageName,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The director's own two ways of making a page (tech-spec §V.1–2).
///
/// Every page that exists today was made by an agent: agent 4 draws one under an
/// arrangement it decided, `newPage` draws a second beside it, and `add_page` is
/// the model doing deterministically what §V.2 describes. All three are the
/// *model's* hand — which leaves the director, whose board it is, with no way to
/// say "this is a page" about the canvas in front of them.
///
/// Two gestures, and they are different asks:
///
/// - **another page**: a rectangle at §V.2's geometry, decided entirely by the
///   pages already on the board. Nothing to choose, so nothing is asked;
/// - **this frame is a page**: the frame the director already drew, promoted in
///   place (§V.1). A frame without the marker is a section, which is all frames
///   have meant until now — so a board divided into sections before pages
///   existed is not stranded, it is one gesture away from being readable a page
///   at a time.
///
/// This module is the part of both that is a decision rather than an edit: which
/// page a new one is measured from, and which of the selected elements are
/// frames that could become pages and what each would be called. The scene edit
/// itself belongs on the canvas, where excalidraw's own element machinery is.
///
/// No canvas, no React, no DOM.

/// What the board's page controls have to say before they are pressed.
export type PageTargets = {
  /// How many pages the board has. Zero is the hand-made board §V.2 draws a
  /// first page *around* what is already there — a different sentence from
  /// adding one to a spread, and the one place the gesture moves nothing but
  /// changes what everything on the board belongs to.
  pages: number;
  /// The page the new one takes its size and its top edge from — the selected
  /// one, else null for the board's last, which is what `addPage` falls back to.
  sourcePageId: string | null;
  /// The selected frames that are not pages yet.
  promotable: number;
};

/// The name a promoted frame keeps or is given.
export type FramePromotion = {
  id: string;
  name: string;
  /// The marker, off `markElementAsPage` — a frame promoted in place is a page
  /// at whatever size it was drawn at, so this is `Custom` unless the director
  /// happened to draw a preset.
  customData: unknown;
};

function selectedFrames(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
): SceneElement[] {
  const chosen = new Set(selectedIds);
  return elements.filter((element) => {
    if (!chosen.has(element.id) || element.isDeleted === true) return false;
    /// Only `frame`, as `boardPages` reads only `frame`: excalidraw's magic
    /// frame is another product's element that happens to be in our scene.
    return element.type === "frame" && !isPageElement(element);
  });
}

/// Which frames the director has selected would become pages, and under what
/// name.
///
/// A frame they already named keeps its name — "Act one" is what the section was
/// for, and renaming it to `Page 3` on promotion would take the one thing the
/// director had already said about it. An unnamed one is numbered past the
/// highest the board carries, counting the promotions themselves so two frames
/// promoted in one gesture do not both become `Page 2`.
export function framesToPromote(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
): FramePromotion[] {
  const named: { name: string }[] = boardPages(elements).map((page) => ({ name: page.name }));
  const promotions: FramePromotion[] = [];

  for (const frame of selectedFrames(elements, selectedIds)) {
    const own = typeof frame.name === "string" ? frame.name.trim() : "";
    const name = own || nextPageName(named);
    named.push({ name });
    promotions.push({ id: frame.id, name, customData: markElementAsPage(frame).customData });
  }

  return promotions;
}

export function pageTargets(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
): PageTargets {
  const pages = boardPages(elements);
  const chosen = new Set(selectedIds);
  /// The first selected page in array order, not the last: selecting a spread
  /// and asking for another page means "another one of these", and the board's
  /// own order is the only tie-break that does not depend on the order they were
  /// clicked in.
  const source = pages.find((page) => chosen.has(page.id)) ?? null;

  return {
    pages: pages.length,
    sourcePageId: source?.id ?? null,
    promotable: framesToPromote(elements, selectedIds).length,
  };
}

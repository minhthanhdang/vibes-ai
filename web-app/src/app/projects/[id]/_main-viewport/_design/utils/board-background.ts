"use client";

import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import { boardPages, pageById } from "@/lib/pages/board-pages";
import { PAGE_BACKGROUND_NONE, setPageBackground } from "@/lib/pages/page-background";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

/// Painting a page from the inspector (canvas.md §XI.4). The colour is the
/// user's; the rectangle it becomes is decided by `lib/pages`, the same module
/// `set_page_background` calls — so a page the user paints and a page an agent
/// paints are the same element made the same way, and neither can drift from
/// what a page read describes.
///
/// This is the whole of the canvas half: read the editor's scene, ask for the
/// edit, write it back as ordinary elements. The ground is then the autosave's
/// to store and ⌘Z's to undo, exactly as a tidy or a palette is.

/// Two kinds of press reach this. A swatch is a decision; a drag inside the
/// colour picker is the same decision being *taken*, and it fires on every
/// frame. So a preview paints without a history entry and the commit that
/// follows captures the whole drag as one step — otherwise choosing a colour
/// costs one undo per pixel the user moved the pointer.
export function paintBoardPage(
  api: ExcalidrawImperativeAPI,
  pageId: string,
  colour: string | null,
  { preview = false }: { preview?: boolean } = {},
) {
  /// Tombstones included, as every other programmatic update on this board
  /// does: dropping them would leave undo with nothing to restore for anything
  /// deleted before the page was painted.
  const scene = api.getSceneElementsIncludingDeleted();
  const read = scene as unknown as SceneElement[];

  const page = pageById(boardPages(read), pageId);
  if (!page) return null;

  const edit = setPageBackground({
    elements: read,
    page,
    colour: colour ?? PAGE_BACKGROUND_NONE,
  });
  /// A colour that is neither a hex nor `"none"` cannot arrive from a swatch or
  /// a colour input, and the colour already standing writes nothing — the same
  /// no-op the tool's door answers with, here saving a revision.
  if (!edit || !edit.elements) return edit?.colour ?? null;

  /// `setPageBackground` answers with plain objects; the editor is holding real
  /// elements and has to keep holding them — an element replaced by a copy of
  /// itself is redrawn from scratch and loses whatever excalidraw was caching
  /// against it. So only the *changes* are taken from the answer, each one
  /// written with `newElementWith`, which bumps the version the render cache is
  /// keyed on.
  const after = new Map(edit.elements.map((element) => [element.id, element]));
  const elements: unknown[] = scene.map((own) => {
    const now = after.get(own.id);
    /// Clearing drops the ground from the array; the editor wants a tombstone
    /// in its place, so undo has something to bring back and the fractional
    /// index of everything around it is left alone.
    if (!now) return newElementWith(own, { isDeleted: true });
    if (now.backgroundColor === own.backgroundColor) return own;
    return newElementWith(own, { backgroundColor: now.backgroundColor as string });
  });

  /// The ground on a page that had none. `restore` is what fills the seed,
  /// version and index, exactly as it does for the scene the board is opened
  /// with, and it goes in at the index `lib/pages` chose — the back of the
  /// page's child run.
  const held = new Set(scene.map((element) => element.id));
  const made = edit.elements.find((element) => !held.has(element.id));
  if (made) {
    const [restored] = restoreElements(
      [made] as unknown as Parameters<typeof restoreElements>[0],
      null,
    );
    /// The three fields the restore is handed one element at a time and cannot
    /// be trusted with: it repairs `frameId` against the elements it was given,
    /// and the page frame is not among them. A ground that lost its frame is a
    /// colour left behind the first time the page is dragged.
    const ground =
      restored &&
      newElementWith(restored, {
        frameId: page.id,
        locked: true,
        customData: made.customData as Record<string, unknown>,
      });
    if (ground) elements.splice(edit.elements.indexOf(made), 0, ground);
  }

  api.updateScene({
    elements: elements as ExcalidrawInitialDataState["elements"],
    captureUpdate: preview ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY,
  });

  return edit.colour;
}

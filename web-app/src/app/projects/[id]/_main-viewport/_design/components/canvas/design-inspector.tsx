"use client";

import { useState } from "react";
import type { BoardSelection } from "@/lib/canvas/moodboard-selection";
import { CropAction } from "./inspector/crop-action";
import { InspectedReference } from "./inspector/inspected-reference";
import { InspectorHeader } from "./inspector/inspector-header";
import { PageProperties } from "./inspector/page-properties";
import { PaletteAction } from "./inspector/palette-action";

/// The board's own second level: what agent 2 made of the photo the user
/// has just selected, read without leaving the canvas. Excalidraw's left island
/// already says everything there is to say about the *element* — opacity, layer,
/// crop — so this only ever says what the element is a picture of.
///
/// Docked to the right edge because the left is where that island appears the
/// moment an image is selected, and the two would sit on top of each other.
///
/// It is also the third surface a photograph's properties are shown on, so the
/// cuts of it belong here as well — and this is the surface where a user is
/// most likely to want one. "Just the hands" is a thought that arrives while the
/// wide shot is sitting on the board next to four others, not while browsing the
/// grid, and until now answering it meant finding the same photo in the sidebar
/// strip — which cannot be done at all when the thing on the board is itself a
/// cut, since a version has no tile there.
///
/// And when the thing on the board *is* a cut, the panel walks up: the frame it
/// came out of, the region of that frame this cut is, and the other cuts made of
/// it — every one of them a drag onto the canvas. A composition made of pieces
/// of photographs is otherwise a board whose pieces cannot be traced back to
/// what they are pieces of.
export function DesignInspector({
  projectId,
  held,
  selection,
  captionable,
  croppable,
  onAddPalette,
  onCaption,
  onKeepCrop,
  onPageBackground,
}: {
  projectId: string;
  /// Whether an agent is rewriting this board. The panel still *reads* — what a
  /// picture is, where a cut came from, what colour the page stands on is worth
  /// looking at while the page is being built — and everything that would write
  /// goes, including the two drag sources, which are handles onto a canvas that
  /// is refusing drops anyway.
  held: boolean;
  selection: BoardSelection;
  /// How many of the selected photos could take a caption, so the offer is not
  /// made for a photo that already has one.
  captionable: number;
  /// How many of them are showing a crop that is not yet a photo of its own.
  croppable: number;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
  /// The colour the selected page stands on, or null to leave it standing on
  /// the board. A preview is a colour still being chosen, painted without a
  /// history entry of its own.
  onPageBackground: (colour: string | null, options?: { preview?: boolean }) => void;
}) {
  /// Opened once, then it follows the selection — rather than opening itself on
  /// every selection. Dropping a batch of references selects each one as it
  /// lands, and a panel that appeared for each would be in the way of the one
  /// thing the user is doing at that moment, which is arranging them.
  const [open, setOpen] = useState(false);

  if (selection.kind === "none") return null;

  if (!open) {
    return (
      <div data-board-overlay className="absolute top-16 right-3 z-10">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white shadow-lg"
        >
          Properties
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label={selection.kind === "page" ? "Page properties" : "Reference properties"}
      /// Over the board, not part of it: a cut dragged out of the list below and
      /// released back on this panel is a drag abandoned, not a photo placed
      /// under the panel it was released on.
      data-board-overlay
      /// One place for both drag sources — the frame stepped up to and every
      /// version row under it. Cancelling the drag before it starts is what a
      /// `draggable` threaded through four components would have bought, and
      /// `ReferenceVersions` is shared with the sidebar, which is not held.
      onDragStartCapture={held ? (event) => event.preventDefault() : undefined}
      className="absolute top-16 right-3 bottom-16 z-10 flex w-72 flex-col overflow-hidden rounded-xl border border-current/10 bg-[var(--background)] text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      {selection.kind === "page" ? (
        /// Keyed on the page so the colour input reseeds from the page that is
        /// now selected rather than staying on the last one's.
        <PageProperties
          key={selection.pageId}
          selection={selection}
          held={held}
          onClose={() => setOpen(false)}
          onPageBackground={onPageBackground}
        />
      ) : selection.kind === "reference" ? (
        /// Keyed on the reference so selecting another photo remounts rather
        /// than showing the previous one's palette until the next query settles.
        <InspectedReference
          key={selection.referenceId}
          projectId={projectId}
          referenceId={selection.referenceId}
          held={held}
          captionable={captionable}
          croppable={croppable}
          onClose={() => setOpen(false)}
          onAddPalette={onAddPalette}
          onCaption={onCaption}
          onKeepCrop={onKeepCrop}
        />
      ) : (
        <>
          <InspectorHeader
            title={`${selection.referenceIds.length} references`}
            onClose={() => setOpen(false)}
          />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <p className="text-xs opacity-60">
              Select a single reference to read its properties.
            </p>
            <PaletteAction
              referenceIds={selection.referenceIds}
              label="Add their palette to the board"
              onAddPalette={onAddPalette}
            />
            <CropAction count={croppable} onKeepCrop={onKeepCrop} />
          </div>
        </>
      )}
    </aside>
  );
}

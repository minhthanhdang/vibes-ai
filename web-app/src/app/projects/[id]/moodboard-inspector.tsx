"use client";

import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { analysisView } from "@/lib/analysis-view";
import { captionText } from "@/lib/moodboard-caption";
import { mergedPalette } from "@/lib/moodboard-palette";
import type { BoardSelection } from "@/lib/moodboard-selection";
import { ColorPalette } from "@/components/color-palette";
import { ReferenceProperties } from "./reference-properties";

/// The board's own second level: what agent 2 made of the photo the director
/// has just selected, read without leaving the canvas. Excalidraw's left island
/// already says everything there is to say about the *element* — opacity, layer,
/// crop — so this only ever says what the element is a picture of.
///
/// Docked to the right edge because the left is where that island appears the
/// moment an image is selected, and the two would sit on top of each other.
export function MoodboardInspector({
  projectId,
  selection,
  captionable,
  croppable,
  onAddPalette,
  onCaption,
  onKeepCrop,
}: {
  projectId: string;
  selection: BoardSelection;
  /// How many of the selected photos could take a caption, so the offer is not
  /// made for a photo that already has one.
  captionable: number;
  /// How many of them are showing a crop that is not yet a photo of its own.
  croppable: number;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
}) {
  /// Opened once, then it follows the selection — rather than opening itself on
  /// every selection. Dropping a batch of references selects each one as it
  /// lands, and a panel that appeared for each would be in the way of the one
  /// thing the director is doing at that moment, which is arranging them.
  const [open, setOpen] = useState(false);

  if (selection.kind === "none") return null;

  if (!open) {
    return (
      <div className="absolute top-16 right-3 z-10">
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
      aria-label="Reference properties"
      className="absolute top-16 right-3 bottom-16 z-10 flex w-72 flex-col overflow-hidden rounded-xl border border-current/10 bg-[var(--background)] text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      {selection.kind === "reference" ? (
        /// Keyed on the reference so selecting another photo remounts rather
        /// than showing the previous one's palette until the next query settles.
        <Reference
          key={selection.referenceId}
          projectId={projectId}
          referenceId={selection.referenceId}
          captionable={captionable}
          croppable={croppable}
          onClose={() => setOpen(false)}
          onAddPalette={onAddPalette}
          onCaption={onCaption}
          onKeepCrop={onKeepCrop}
        />
      ) : (
        <>
          <Header title={`${selection.referenceIds.length} references`} onClose={() => setOpen(false)} />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <p className="text-xs opacity-60">
              Select a single reference to read its properties.
            </p>
            {/* The one question worth asking of several photos at once, and the
                one a per-reference panel cannot answer: what colour are they
                together. */}
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

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-current/10 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close properties"
        className="shrink-0 rounded-md border border-current/20 px-1.5 py-0.5 text-[11px] opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

/// The palette agent 2 read out of these references, as an object on the board.
///
/// A colour that can only be read in a panel is not part of the board a
/// director shows anyone — or of the deck agent 5 builds from it — so the one
/// thing this panel can do that the gallery's cannot is put it on the canvas.
/// It reads the same per-reference query the panel body polls, so the colours
/// offered are always the colours on screen, and a selection of five costs five
/// small reads of rows that are usually already cached.
function PaletteAction({
  referenceIds,
  label,
  onAddPalette,
}: {
  referenceIds: readonly string[];
  label: string;
  onAddPalette: (colors: string[]) => void;
}) {
  const trpc = useTRPC();
  const results = useQueries({
    queries: referenceIds.map((referenceId) =>
      trpc.reference.properties.queryOptions({ referenceId }),
    ),
  });

  const palettes = results.map((result) => {
    const view = result.data ? analysisView(result.data) : null;
    return view?.kind === "ready" ? view.properties.colorPalette : [];
  });
  const colors = mergedPalette(palettes);

  /// Nothing analyzed yet, or analyzed and colourless: the panel already says
  /// which of the two it is, and an offer to place an empty bar would be a
  /// button that does nothing.
  if (colors.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-current/10 pt-3">
      <ColorPalette colors={colors} size="sm" />
      <button
        type="button"
        onClick={() => onAddPalette(colors)}
        className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
      >
        {label}
      </button>
    </div>
  );
}

/// The reference's title, put on the board as a caption grouped with the photo.
///
/// A moodboard is images and what is said about them, and until now saying it
/// meant drawing a text element that knew nothing about the photo — separated
/// from it by the first tidy, and left behind by the first drag. Grouping the
/// two is what makes a caption belong to a photo, and the title the director
/// already gave the reference is the caption they would have typed.
function CaptionAction({
  title,
  count,
  onCaption,
}: {
  title: string;
  count: number;
  onCaption: (text: string) => void;
}) {
  const text = captionText(title);
  if (!text) return null;

  return (
    <button
      type="button"
      onClick={() => onCaption(text)}
      title={`Add “${text}” under ${count === 1 ? "the photo" : `each of the ${count} photos`}, grouped with it so it moves and tidies as one`}
      className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
    >
      {count === 1 ? "Caption with its title" : `Caption ${count} photos`}
    </button>
  );
}

/// The crop the director framed on the board, kept as a photo of the project.
///
/// Excalidraw's crop is a window onto the whole file, and everything outside the
/// canvas keeps seeing the file: the gallery shows the frame that was cut away,
/// agent 2 reads a palette off it, a deck built from these references gets the
/// wide shot, and the board downloads the whole photograph to draw a corner of
/// it. "This part of this frame is the shot" is a judgement worth keeping, so
/// this is where it stops being a property of one element on one board.
function CropAction({ count, onKeepCrop }: { count: number; onKeepCrop: () => void }) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onKeepCrop}
      title={
        count === 1
          ? "Save the cropped area as a reference of its own and point this image at it — nothing moves on the board"
          : "Save each cropped area as a reference of its own and point its image at it — nothing moves on the board"
      }
      className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
    >
      {count === 1 ? "Keep this crop as a reference" : `Keep ${count} crops as references`}
    </button>
  );
}

function Reference({
  projectId,
  referenceId,
  captionable,
  croppable,
  onClose,
  onAddPalette,
  onCaption,
  onKeepCrop,
}: {
  projectId: string;
  referenceId: string;
  captionable: number;
  croppable: number;
  onClose: () => void;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
}) {
  const trpc = useTRPC();
  /// The project's references are already in cache — the sidebar strip renders
  /// from this exact query — so the title and thumbnail cost nothing here.
  const { data: references } = useQuery(trpc.reference.listByProject.queryOptions({ projectId }));
  const reference = references?.find((entry) => entry.id === referenceId);

  return (
    <>
      <Header title={reference?.title || "Reference"} onClose={onClose} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {references && !reference ? (
          /// The element is still on the board pointing at a row that is gone —
          /// excalidraw draws it as a placeholder, and this says why.
          <p className="text-xs opacity-60">This reference is no longer in the project.</p>
        ) : (
          <>
            {reference ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={reference.thumbUrl}
                alt={reference.title}
                className="w-full rounded-lg object-cover"
              />
            ) : null}
            <ReferenceProperties referenceId={referenceId} />
            <CropAction count={croppable} onKeepCrop={onKeepCrop} />
            {reference && captionable > 0 ? (
              <CaptionAction
                title={reference.title}
                count={captionable}
                onCaption={onCaption}
              />
            ) : null}
            <PaletteAction
              referenceIds={[referenceId]}
              label="Add palette to the board"
              onAddPalette={onAddPalette}
            />
          </>
        )}
      </div>
    </>
  );
}

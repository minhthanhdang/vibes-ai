"use client";

import { useState } from "react";
import type { BoardSelection } from "@/lib/canvas/moodboard-selection";
import { CropAction } from "./inspector/crop-action";
import { InspectedReference } from "./inspector/inspected-reference";
import { InspectorHeader } from "./inspector/inspector-header";
import { PageProperties } from "./inspector/page-properties";
import { PaletteAction } from "./inspector/palette-action";

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
  held: boolean;
  selection: BoardSelection;
  captionable: number;
  croppable: number;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
  onPageBackground: (colour: string | null, options?: { preview?: boolean }) => void;
}) {
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
      data-board-overlay
      onDragStartCapture={held ? (event) => event.preventDefault() : undefined}
      className="absolute top-16 right-3 bottom-16 z-10 flex w-72 flex-col overflow-hidden rounded-xl border border-current/10 bg-[var(--background)] text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      {selection.kind === "page" ? (
        <PageProperties
          key={selection.pageId}
          selection={selection}
          held={held}
          onClose={() => setOpen(false)}
          onPageBackground={onPageBackground}
        />
      ) : selection.kind === "reference" ? (
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

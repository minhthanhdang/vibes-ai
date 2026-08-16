"use client";

import { useEffect, useRef } from "react";
import { neighborId } from "@/lib/gallery";
import { ReferenceProperties } from "./reference-properties";

export type LightboxReference = {
  id: string;
  title: string;
  isFavorite: boolean;
  displayUrl: string;
  width: number | null;
  height: number | null;
};

/// The original, not the grid's downscaled copy — this is the one place the
/// full-resolution bytes are worth fetching, and the tile behind it stays
/// visible while they arrive.
export function ReferenceLightbox({
  references,
  openId,
  onOpen,
  onToggleFavorite,
  onRemove,
}: {
  references: LightboxReference[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  onToggleFavorite: (reference: LightboxReference) => void;
  onRemove: (reference: LightboxReference) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reference = references.find((candidate) => candidate.id === openId) ?? null;
  const isOpen = reference !== null;

  /// showModal() is what gives the viewer Escape, a focus trap and a backdrop
  /// without any of it being written here; `open` as a prop would give none.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (isOpen && !element.open) element.showModal();
    if (!isOpen && element.open) element.close();
  }, [isOpen]);

  function step(delta: number) {
    const next = neighborId(references, openId, delta);
    if (next) onOpen(next);
  }

  return (
    <dialog
      ref={dialog}
      onClose={() => onOpen(null)}
      onClick={(event) => {
        if (event.target === dialog.current) onOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
      className="m-auto max-h-dvh max-w-dvw bg-transparent p-0 text-[var(--foreground)] backdrop:bg-black/80"
    >
      {reference ? (
        <div className="flex max-h-dvh w-[min(96dvw,1400px)] flex-col items-center gap-3 p-4">
          <div className="flex min-h-0 w-full flex-col items-center gap-4 md:flex-row md:items-stretch">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={reference.displayUrl}
              alt={reference.title}
              width={reference.width ?? undefined}
              height={reference.height ?? undefined}
              className="max-h-[76dvh] w-auto min-w-0 flex-1 rounded-lg object-contain"
            />

            {/* Keyed on the reference so stepping to a neighbour remounts the
                panel rather than showing the previous image's properties until
                the next query settles. */}
            <aside className="w-full shrink-0 overflow-y-auto rounded-lg bg-[var(--background)]/95 p-4 md:max-h-[76dvh] md:w-[320px]">
              <ReferenceProperties key={reference.id} referenceId={reference.id} />
            </aside>
          </div>

          <div className="flex w-full items-center gap-3 rounded-lg bg-[var(--background)]/90 px-4 py-2 text-sm">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous reference"
              className="opacity-60 hover:opacity-100"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next reference"
              className="opacity-60 hover:opacity-100"
            >
              →
            </button>

            <span className="min-w-0 flex-1 truncate">{reference.title}</span>
            {reference.width && reference.height ? (
              <span className="shrink-0 opacity-50">
                {reference.width}×{reference.height}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => onToggleFavorite(reference)}
              aria-pressed={reference.isFavorite}
              aria-label={reference.isFavorite ? "Remove from favorites" : "Add to favorites"}
              className="shrink-0"
            >
              {reference.isFavorite ? "★" : "☆"}
            </button>
            <button
              type="button"
              onClick={() => onRemove(reference)}
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => onOpen(null)}
              aria-label="Close"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

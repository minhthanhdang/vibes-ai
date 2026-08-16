"use client";

import { useEffect, useRef } from "react";
import { neighborId } from "@/lib/gallery";

export type LightboxReference = {
  id: string;
  title: string;
  isFavorite: boolean;
  displayUrl: string;
  width: number | null;
  height: number | null;
};

/// The tile already downloaded these exact bytes under the same URL, so opening
/// a reference full size is a cache hit rather than a second fetch.
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
        <div className="flex max-h-dvh flex-col items-center gap-3 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={reference.displayUrl}
            alt={reference.title}
            width={reference.width ?? undefined}
            height={reference.height ?? undefined}
            className="max-h-[80dvh] w-auto max-w-[90dvw] rounded-lg object-contain"
          />

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

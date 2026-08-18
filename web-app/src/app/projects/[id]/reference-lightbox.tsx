"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ReferenceOrigin } from "@/generated/prisma/enums";
import { neighborId, viewerStep } from "@/lib/references/gallery";
import { cropBoxOutline } from "@/lib/references/reference-version";
import { ReferenceProperties } from "./reference-properties";
import { ReferenceVersions } from "./reference-versions";

export type LightboxReference = {
  id: string;
  title: string;
  isFavorite: boolean;
  displayUrl: string;
  width: number | null;
  height: number | null;
  /// Carried for the Remove control the gallery lends this viewer: what the
  /// conversation is told a removal took is worded off the row's provenance, and
  /// the viewer is the one place the whole picture is on screen when it goes.
  origin?: ReferenceOrigin | null;
};

/// The original, not the grid's downscaled copy — this is the one place the
/// full-resolution bytes are worth fetching, and the tile behind it stays
/// visible while they arrive.
///
/// It is also the other place a photograph's properties are shown, which is
/// where a cut of it belongs: the grid hides versions on purpose and says only
/// how many there are, and the panel that holds them is reached by a different
/// column. A user who opened the photograph to look at it closely would
/// otherwise find no word here about the crops made of it — and this is the
/// best frame in the app to ask for one and to judge the answer on, because it
/// is the only surface showing the photograph at its own size.
export function ReferenceLightbox({
  projectId,
  references,
  openId,
  onOpen,
  onToggleFavorite,
  renderRemove,
}: {
  projectId: string;
  references: LightboxReference[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  onToggleFavorite: (reference: LightboxReference) => void;
  /// The removal is the gallery's — it owns the mutation, the board-usage read
  /// and which reference is armed, and the viewer is a second place the same
  /// control is shown rather than a second way to delete.
  renderRemove: (reference: LightboxReference) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reference = references.find((candidate) => candidate.id === openId) ?? null;
  const isOpen = reference !== null;

  /// Which part of the photograph a cut is, drawn on the photograph. Both the
  /// cut being pointed at below and the box the cropper has just answered with
  /// are carried with the reference they belong to, because stepping to the
  /// next photograph is not an event the versions list gets to report on — it
  /// is remounted under the new one, and a box left over would be a claim about
  /// a frame it was never measured against.
  const [pointed, setPointed] = useState<{ id: string; cropBox: number[] } | null>(null);
  const [proposed, setProposed] = useState<{ id: string; cropBox: number[] } | null>(null);
  /// Rebuilt only when the shown reference changes — the same event that
  /// remounts the section calling it — so the effect that publishes a proposal
  /// upward does not re-fire on every render of the viewer.
  const propose = useCallback(
    (cropBox: number[] | null) => setProposed(cropBox && openId ? { id: openId, cropBox } : null),
    [openId],
  );

  /// Pointing wins while it lasts, exactly as it does in the properties panel:
  /// a user reading the offer can still check where an existing cut is, and
  /// the offer comes back when the pointer leaves.
  const outline = cropBoxOutline(
    (pointed?.id === openId ? pointed.cropBox : null) ??
      (proposed?.id === openId ? proposed.cropBox : null),
  );

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
      /// Not while the press is going into the crop prompt: an arrow moving the
      /// caret through "just the hands" would otherwise take the photograph the
      /// sentence is about off the screen, and the words with it.
      onKeyDown={(event) => {
        const delta = viewerStep(event.key, {
          editing: event.target instanceof HTMLInputElement,
        });
        if (delta) step(delta);
      }}
      className="m-auto max-h-dvh max-w-dvw bg-transparent p-0 text-[var(--foreground)] backdrop:bg-black/80"
    >
      {reference ? (
        <div className="flex max-h-dvh w-[min(96dvw,1400px)] flex-col items-center gap-3 p-4">
          <div className="flex min-h-0 w-full flex-col items-center gap-4 md:flex-row md:items-stretch">
            {/* The picture, and — while a cut of it is pointed at beside it, or
                one is being offered — which part of it that cut is. The box is
                drawn on a wrapper that shrinks to the image rather than on the
                image's own box: `object-contain` centres the picture inside
                whatever space it is given, and a percentage overlay against
                that space would sit in the letterboxing. */}
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
              <div className="relative min-w-0 overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reference.displayUrl}
                  alt={reference.title}
                  width={reference.width ?? undefined}
                  height={reference.height ?? undefined}
                  className="block max-h-[76dvh] w-auto max-w-full"
                />
                {outline ? (
                  <div
                    aria-hidden
                    style={{
                      left: `${outline.left}%`,
                      top: `${outline.top}%`,
                      width: `${outline.width}%`,
                      height: `${outline.height}%`,
                    }}
                    className="pointer-events-none absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                  />
                ) : null}
              </div>
            </div>

            {/* Keyed on the reference so stepping to a neighbour remounts the
                panel rather than showing the previous image's properties until
                the next query settles. */}
            <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-lg bg-[var(--background)]/95 p-4 md:max-h-[76dvh] md:w-[320px]">
              <ReferenceProperties key={reference.id} referenceId={reference.id} />
              {/* The cuts of this photograph, where the photograph's properties
                  are. No door into a cut from here — a version's own properties
                  and the cuts of it are the sidebar panel's walk, and a viewer
                  showing one reference at full size has nowhere to walk to. */}
              <ReferenceVersions
                key={`versions:${reference.id}`}
                projectId={projectId}
                referenceId={reference.id}
                frame={reference}
                canPlace={false}
                onPoint={(cropBox) => setPointed(cropBox ? { id: reference.id, cropBox } : null)}
                onPropose={propose}
              />
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
            {renderRemove(reference)}
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

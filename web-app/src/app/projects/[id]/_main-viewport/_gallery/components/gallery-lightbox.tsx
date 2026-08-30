"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { neighborId, viewerStep } from "@/lib/references/gallery";
import { cropBoxOutline } from "@/lib/references/reference-version";
import { DrawnFrom } from "../../../_reference/components/drawn-from";
import { ReferenceProperties } from "../../../_reference/components/reference-properties";
import { ReferenceVersions } from "../../../_reference/components/reference-versions";
import type { LightboxReference } from "../types";

export function GalleryLightbox({
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
  renderRemove: (reference: LightboxReference) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reference = references.find((candidate) => candidate.id === openId) ?? null;
  const isOpen = reference !== null;

  const [pointed, setPointed] = useState<{ id: string; cropBox: number[] } | null>(null);
  const [proposed, setProposed] = useState<{ id: string; cropBox: number[] } | null>(null);
  const propose = useCallback(
    (cropBox: number[] | null) => setProposed(cropBox && openId ? { id: openId, cropBox } : null),
    [openId],
  );

  const outline = cropBoxOutline(
    (pointed?.id === openId ? pointed.cropBox : null) ??
      (proposed?.id === openId ? proposed.cropBox : null),
  );

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

            <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-lg bg-[var(--background)]/95 p-4 md:max-h-[76dvh] md:w-[320px]">
              <DrawnFrom reference={reference} />
              <ReferenceProperties key={reference.id} referenceId={reference.id} />
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

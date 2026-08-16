"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import type { BoardSelection } from "@/lib/moodboard-selection";
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
}: {
  projectId: string;
  selection: BoardSelection;
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
          onClose={() => setOpen(false)}
        />
      ) : (
        <>
          <Header title={`${selection.referenceIds.length} references`} onClose={() => setOpen(false)} />
          <p className="p-3 text-xs opacity-60">
            Select a single reference to read its properties.
          </p>
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

function Reference({
  projectId,
  referenceId,
  onClose,
}: {
  projectId: string;
  referenceId: string;
  onClose: () => void;
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
          </>
        )}
      </div>
    </>
  );
}

"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  nextSecondLevelSelection,
  resolveSecondLevelSelection,
} from "@/lib/second-level-sidebar";
import { REFERENCE_DRAG_MIME, encodeReferenceDrag } from "@/lib/moodboard-drop";
import { ReferencePropertiesPanel } from "./reference-properties-panel";

/// The drag the moodboard listens for. The thumbnail is already decoded in the
/// tile, so a reference uploaded before the dimension columns existed still
/// drags with its real aspect ratio rather than falling back to a square —
/// thumbnails are fitted, never cropped, so the shape is the original's.
function startReferenceDrag(
  event: React.DragEvent<HTMLElement>,
  reference: { id: string; width: number | null; height: number | null },
) {
  const thumb = event.currentTarget.querySelector("img");
  event.dataTransfer.setData(
    REFERENCE_DRAG_MIME,
    encodeReferenceDrag({
      referenceId: reference.id,
      width: reference.width ?? thumb?.naturalWidth ?? null,
      height: reference.height ?? thumb?.naturalHeight ?? null,
    }),
  );
  event.dataTransfer.effectAllowed = "copy";
}

/// The references, small, inside the assistant's own column: the director is
/// talking about a look, and this is what they point at while doing it.
/// Clicking one opens the second-level panel rather than the gallery's modal —
/// the chat has to stay readable beside the properties being discussed.
export function SidebarReferences({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const { data: references } = useQuery(
    trpc.reference.listByProject.queryOptions({ projectId }),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const openId = resolveSecondLevelSelection(selectedId, references ?? []);
  const selected = references?.find((reference) => reference.id === openId) ?? null;
  const close = useCallback(() => setSelectedId(null), []);

  if (!references?.length) return null;

  return (
    <div className="flex max-h-52 shrink-0 flex-col gap-2 overflow-y-auto border-b border-current/10 p-3">
      <span className="text-[11px] font-medium tracking-widest uppercase opacity-45">
        References
      </span>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
        {references.map((reference) => (
          <li key={reference.id}>
            <button
              type="button"
              draggable
              onDragStart={(event) => startReferenceDrag(event, reference)}
              onClick={() => setSelectedId((current) => nextSecondLevelSelection(current, reference.id))}
              aria-pressed={openId === reference.id}
              title={`${reference.title || "Reference"} — drag onto the moodboard`}
              aria-label={`Show properties of ${reference.title || "reference"}`}
              className={`block aspect-square w-full cursor-grab overflow-hidden rounded-md ring-offset-1 ring-offset-[var(--background)] active:cursor-grabbing ${
                openId === reference.id ? "ring-2 ring-current" : "hover:ring-1 hover:ring-current/40"
              }`}
            >
              {/* The image's own native drag would carry a URL instead of the
                  reference, and it starts before the button's — so the tile is
                  the only draggable thing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reference.thumbUrl}
                alt={reference.title}
                loading="lazy"
                draggable={false}
                className="h-full w-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>

      {selected ? <ReferencePropertiesPanel reference={selected} onClose={close} /> : null}
    </div>
  );
}

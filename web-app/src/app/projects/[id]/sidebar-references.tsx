"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  nextSecondLevelSelection,
  resolveSecondLevelSelection,
} from "@/lib/second-level-sidebar";
import {
  REFERENCE_DRAG_MIME,
  draggedReferenceIds,
  encodeReferenceDrag,
  toggledDragSelection,
} from "@/lib/moodboard-drop";
import { ReferencePropertiesPanel } from "./reference-properties-panel";

type SidebarReference = { id: string; width: number | null; height: number | null };

/// The thumbnail is already decoded in the tile, so a reference uploaded before
/// the dimension columns existed still drags with its real aspect ratio rather
/// than falling back to a square — thumbnails are fitted, never cropped, so the
/// shape is the original's. Read out of the list rather than off the dragged
/// tile, because a drag of six carries five tiles the event never touches.
function dragItem(list: Element | null, reference: SidebarReference) {
  const thumb = list?.querySelector<HTMLImageElement>(
    `img[data-reference-id="${CSS.escape(reference.id)}"]`,
  );
  return {
    referenceId: reference.id,
    width: reference.width ?? thumb?.naturalWidth ?? null,
    height: reference.height ?? thumb?.naturalHeight ?? null,
  };
}

/// The drag the moodboard listens for. Dragging a tile that is part of the
/// selection drags the whole selection: choosing six photos and placing them one
/// at a time is the same arrangement done six times.
function startReferenceDrag(
  event: React.DragEvent<HTMLElement>,
  references: readonly SidebarReference[],
  selected: readonly string[],
  draggedId: string,
) {
  const list = event.currentTarget.closest("ul");
  const wanted = new Set(
    draggedReferenceIds(
      references.map((reference) => reference.id),
      selected,
      draggedId,
    ),
  );

  event.dataTransfer.setData(
    REFERENCE_DRAG_MIME,
    encodeReferenceDrag(
      references
        .filter((reference) => wanted.has(reference.id))
        .map((reference) => dragItem(list, reference)),
    ),
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
  /// What the next drag carries, which is not what the properties panel is
  /// about: a plain click is still "show me this one", and building a set to
  /// drag is the modifier-click on top of it.
  const [dragSelection, setDragSelection] = useState<string[]>([]);

  const openId = resolveSecondLevelSelection(selectedId, references ?? []);
  const selected = references?.find((reference) => reference.id === openId) ?? null;
  const close = useCallback(() => setSelectedId(null), []);
  const clearDragSelection = useCallback(() => setDragSelection([]), []);

  if (!references?.length) return null;

  /// The order the batch fills the grid in, which is the order the tiles are
  /// shown in rather than the order they were clicked — the drop is meant to
  /// look like the strip it came from.
  const dropOrder = references
    .filter((reference) => dragSelection.includes(reference.id))
    .map((reference) => reference.id);

  const chooseReference = (event: React.MouseEvent, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setDragSelection((current) => toggledDragSelection(current, id));
      return;
    }
    setDragSelection([]);
    setSelectedId((current) => nextSecondLevelSelection(current, id));
  };

  return (
    <div className="flex max-h-52 shrink-0 flex-col gap-2 overflow-y-auto border-b border-current/10 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-widest uppercase opacity-45">
          References
        </span>
        {dropOrder.length > 0 ? (
          <button
            type="button"
            onClick={clearDragSelection}
            className="text-[11px] opacity-60 hover:opacity-100"
          >
            {dropOrder.length} selected — clear
          </button>
        ) : null}
      </div>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
        {references.map((reference) => {
          const picked = dragSelection.includes(reference.id);
          return (
            <li key={reference.id} className="relative">
              <button
                type="button"
                draggable
                onDragStart={(event) =>
                  startReferenceDrag(event, references, dragSelection, reference.id)
                }
                /// A set that has landed has done its job; one whose drag was
                /// abandoned (`dropEffect: "none"`) is still what the director
                /// picked, and clearing it would make them pick it again.
                onDragEnd={(event) => {
                  if (event.dataTransfer.dropEffect !== "none") clearDragSelection();
                }}
                onClick={(event) => chooseReference(event, reference.id)}
                aria-pressed={picked || openId === reference.id}
                title={`${reference.title || "Reference"} — drag onto the moodboard, ⌘-click to drag several`}
                aria-label={`Show properties of ${reference.title || "reference"}`}
                className={`block aspect-square w-full cursor-grab overflow-hidden rounded-md ring-offset-1 ring-offset-[var(--background)] active:cursor-grabbing ${
                  picked
                    ? "ring-2 ring-sky-500"
                    : openId === reference.id
                      ? "ring-2 ring-current"
                      : "hover:ring-1 hover:ring-current/40"
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
                  data-reference-id={reference.id}
                  className="h-full w-full object-cover"
                />
              </button>
              {picked ? (
                <span className="pointer-events-none absolute top-0.5 right-0.5 rounded-full bg-sky-500 px-1 text-[9px] leading-4 font-medium text-white">
                  {dropOrder.indexOf(reference.id) + 1}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {selected ? <ReferencePropertiesPanel reference={selected} onClose={close} /> : null}
    </div>
  );
}

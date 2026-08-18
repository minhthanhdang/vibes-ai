"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  nextSecondLevelSelection,
  resolveSecondLevelSelection,
} from "@/lib/ui/second-level-sidebar";
import {
  REFERENCE_DRAG_MIME,
  draggedReferenceIds,
  encodeReferenceDrag,
  referenceDragItem,
  toggledDragSelection,
} from "@/lib/canvas/moodboard-drop";
import { galleryAnalysisIndex, isGalleryAnalysisPending } from "@/lib/analysis/gallery-analysis";
import {
  NO_REFERENCE_FILTER,
  filteredReferences,
  isFilterActive,
  isGeneratedReference,
  referenceTagKeys,
  tagFacets,
  toggledFilterTag,
  type ReferenceFilter,
  type ReferenceTagIndex,
  type TagKey,
} from "@/lib/references/reference-filter";
import { useBoardPlacement } from "./board-placement";
import { inspectReference, useInspectedReference } from "./reference-inspection";
import { ReferencePropertiesPanel } from "./reference-properties-panel";

/// Matches the gallery's poll: the strip and the grid are watching the same
/// jobs, and the tag a filter is built from is the one a tile is showing.
const POLL_MS = 4000;

type SidebarReference = { id: string; width: number | null; height: number | null };

/// The thumbnail is already decoded in the tile, so a reference uploaded before
/// the dimension columns existed still drags with its real aspect ratio rather
/// than falling back to a square — thumbnails are fitted, never cropped, so the
/// shape is the original's. Read out of the list rather than off the dragged
/// tile, because a drag of six carries five tiles the event never touches.
function dragItem(list: Element | null, reference: SidebarReference) {
  return referenceDragItem(
    reference,
    list?.querySelector<HTMLImageElement>(`img[data-reference-id="${CSS.escape(reference.id)}"]`),
  );
}

/// The drag the moodboard listens for. Dragging a tile that is part of the
/// selection drags the whole selection: choosing six photos and placing them one
/// at a time is the same arrangement done six times.
///
/// `references` is what the strip is *showing*, so a filter narrows what a drag
/// carries the same way removing a reference does — dragging a visible tile
/// cannot silently bring in photos the user filtered away.
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

const CONTROL = "rounded-md border border-current/20 px-2 py-1 text-[11px]";

/// The facet list, folded away until asked for: the strip is one band of a
/// column that also holds the chat, and a project with four looks in it does not
/// need six rows of chips open while a board is being arranged.
function TagFilters({
  groups,
  active,
  onToggle,
}: {
  groups: ReturnType<typeof tagFacets>;
  active: readonly TagKey[];
  onToggle: (key: TagKey) => void;
}) {
  if (!groups.length) {
    return (
      <p className="text-[11px] opacity-45">
        No analyzed properties yet — tags appear as agent 2 reads each reference.
      </p>
    );
  }

  return (
    <div className="flex max-h-28 flex-col gap-1.5 overflow-y-auto pr-1">
      {groups.map((group) => (
        <div key={group.dimension} className="flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[10px] tracking-wider uppercase opacity-40">
            {group.label}
          </span>
          {group.facets.map((facet) => {
            const on = active.includes(facet.key);
            return (
              <button
                key={facet.key}
                type="button"
                onClick={() => onToggle(facet.key)}
                aria-pressed={on}
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  on
                    ? "bg-sky-500 text-white"
                    : "border border-current/20 opacity-70 hover:opacity-100"
                }`}
              >
                {facet.label} <span className="opacity-60">{facet.count}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/// The references, small, inside the assistant's own column: the user is
/// talking about a look, and this is what they point at while doing it.
/// Clicking one opens the second-level panel rather than the gallery's modal —
/// the chat has to stay readable beside the properties being discussed.
export function SidebarReferences({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const { data: references } = useQuery(
    trpc.reference.listByProject.queryOptions({ projectId }),
  );
  /// Held outside the strip: the gallery grid opens this panel too — a tile
  /// showing how many crops a photo has is a tile whose crops are one click
  /// away — and the two are in different columns of the workspace.
  const selectedId = useInspectedReference();
  /// What the next drag carries, which is not what the properties panel is
  /// about: a plain click is still "show me this one", and building a set to
  /// drag is the modifier-click on top of it.
  const [dragSelection, setDragSelection] = useState<string[]>([]);
  const [rawFilter, setFilter] = useState<ReferenceFilter>(NO_REFERENCE_FILTER);
  const [isTagsOpen, setIsTagsOpen] = useState(false);

  /// What the open board is showing, published by the canvas in the other
  /// column. Null while the gallery is up — and then "not on the board" is a
  /// question with no board to ask it of, so the control is not offered and the
  /// filter is read as if it were off.
  const placement = useBoardPlacement();
  const placed = placement?.counts ?? null;
  /// Offered only where it can separate something: a project nobody has asked
  /// for a picture in has one kind of reference, and a control that hides
  /// nothing is a control that reads as broken.
  const hasGenerated = useMemo(
    () => (references ?? []).some(isGeneratedReference),
    [references],
  );
  const filter = useMemo(
    () => ({
      ...rawFilter,
      ...(placed ? null : { unplacedOnly: false }),
      ...(hasGenerated ? null : { generatedOnly: false }),
    }),
    [placed, hasGenerated, rawFilter],
  );

  /// The same read the gallery grid polls, so the strip costs no extra round
  /// trip when both are on screen — and keeps working when only it is.
  const referenceIds = (references ?? []).map((reference) => reference.id);
  const { data: analysisSource } = useQuery(
    trpc.reference.analysisByProject.queryOptions(
      { projectId },
      {
        refetchInterval: ({ state }) =>
          state.data && !isGalleryAnalysisPending(galleryAnalysisIndex(state.data), referenceIds)
            ? false
            : POLL_MS,
      },
    ),
  );

  const tags: ReferenceTagIndex = useMemo(() => {
    const index = new Map<string, TagKey[]>();
    if (!analysisSource) return index;
    for (const [id, view] of galleryAnalysisIndex(analysisSource)) {
      if (view.kind === "ready") index.set(id, referenceTagKeys(view.properties));
    }
    return index;
  }, [analysisSource]);

  const openId = resolveSecondLevelSelection(selectedId, references ?? []);
  const selected = references?.find((reference) => reference.id === openId) ?? null;
  const close = useCallback(() => inspectReference(null), []);
  const clearDragSelection = useCallback(() => setDragSelection([]), []);

  const shown = useMemo(
    () => filteredReferences(references ?? [], tags, filter, placed),
    [references, tags, filter, placed],
  );
  const groups = useMemo(() => tagFacets(references ?? [], tags), [references, tags]);

  if (!references?.length) return null;

  /// The order the batch fills the grid in, which is the order the tiles are
  /// shown in rather than the order they were clicked — the drop is meant to
  /// look like the strip it came from.
  const dropOrder = shown
    .filter((reference) => dragSelection.includes(reference.id))
    .map((reference) => reference.id);
  /// A picked tile the filter is hiding will not be in the next drag, and the
  /// user cannot see that it is gone — so the count says so.
  const hiddenPicks = dragSelection.filter(
    (id) => !dropOrder.includes(id) && referenceIds.includes(id),
  ).length;

  const chooseReference = (event: React.MouseEvent, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setDragSelection((current) => toggledDragSelection(current, id));
      return;
    }
    setDragSelection([]);
    inspectReference(nextSecondLevelSelection(selectedId, id));
  };

  return (
    <div className="flex max-h-72 shrink-0 flex-col gap-2 border-b border-current/10 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-widest uppercase opacity-45">
          References
        </span>
        {dropOrder.length > 0 || hiddenPicks > 0 ? (
          <button
            type="button"
            onClick={clearDragSelection}
            className="text-[11px] opacity-60 hover:opacity-100"
          >
            {dropOrder.length} selected
            {hiddenPicks > 0 ? ` (${hiddenPicks} hidden)` : ""} — clear
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="search"
          value={filter.query}
          onChange={(event) =>
            setFilter((current) => ({ ...current, query: event.target.value }))
          }
          placeholder="Search title or tag"
          aria-label="Filter references"
          className={`min-w-0 flex-1 ${CONTROL} bg-transparent outline-none focus:border-current/50`}
        />
        <button
          type="button"
          onClick={() => setFilter((current) => ({ ...current, favoritesOnly: !current.favoritesOnly }))}
          aria-pressed={filter.favoritesOnly}
          title="Favorites only"
          className={`${CONTROL} ${filter.favoritesOnly ? "border-current/60 opacity-100" : "opacity-60 hover:opacity-100"}`}
        >
          {filter.favoritesOnly ? "★" : "☆"}
        </button>
        {/* Only while a board is open, and only one direction of the question:
            which photos are already on the board is what the tiles themselves
            say, and what a user asks the strip for is what is left. */}
        {placed ? (
          <button
            type="button"
            onClick={() =>
              setFilter((current) => ({ ...current, unplacedOnly: !current.unplacedOnly }))
            }
            aria-pressed={filter.unplacedOnly}
            title="Only references that are not on this board yet"
            className={`${CONTROL} ${filter.unplacedOnly ? "border-current/60 opacity-100" : "opacity-60 hover:opacity-100"}`}
          >
            Unused
          </button>
        ) : null}
        {/* Beside the star for the reason it is beside the star: both answer
            "which of these did somebody choose", and this is the half of that
            question the user did not answer. */}
        {hasGenerated ? (
          <button
            type="button"
            onClick={() =>
              setFilter((current) => ({ ...current, generatedOnly: !current.generatedOnly }))
            }
            aria-pressed={filter.generatedOnly}
            title="Only the pictures the assistant drew"
            className={`${CONTROL} ${filter.generatedOnly ? "border-current/60 opacity-100" : "opacity-60 hover:opacity-100"}`}
          >
            Generated
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setIsTagsOpen((open) => !open)}
          aria-expanded={isTagsOpen}
          className={`${CONTROL} ${filter.tags.length ? "border-current/60" : "opacity-60 hover:opacity-100"}`}
        >
          Tags{filter.tags.length ? ` ${filter.tags.length}` : ""}
        </button>
        {isFilterActive(filter) ? (
          <button
            type="button"
            onClick={() => setFilter(NO_REFERENCE_FILTER)}
            className={`${CONTROL} opacity-60 hover:opacity-100`}
          >
            Reset
          </button>
        ) : null}
      </div>

      {isTagsOpen ? (
        <TagFilters
          groups={groups}
          active={filter.tags}
          onToggle={(key) =>
            setFilter((current) => ({ ...current, tags: toggledFilterTag(current.tags, key) }))
          }
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {shown.length ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
            {shown.map((reference) => {
              const picked = dragSelection.includes(reference.id);
              /// How many elements of the open board show this photo. Undefined
              /// is either "not on the board" or "no board open", and the two
              /// look the same on a tile — the strip only marks what *is*
              /// placed, so nothing is claimed while the gallery is up.
              const onBoard = placed?.get(reference.id);
              const drawn = isGeneratedReference(reference);
              return (
                <li key={reference.id} className="relative">
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      startReferenceDrag(event, shown, dragSelection, reference.id)
                    }
                    /// A set that has landed has done its job; one whose drag was
                    /// abandoned (`dropEffect: "none"`) is still what the user
                    /// picked, and clearing it would make them pick it again.
                    onDragEnd={(event) => {
                      if (event.dataTransfer.dropEffect !== "none") clearDragSelection();
                    }}
                    onClick={(event) => chooseReference(event, reference.id)}
                    aria-pressed={picked || openId === reference.id}
                    title={`${reference.title || "Reference"}${drawn ? " — generated" : ""}${
                      onBoard
                        ? onBoard === 1
                          ? " — on this board"
                          : ` — on this board ${onBoard} times`
                        : ""
                    } — drag onto the moodboard, ⌘-click to drag several`}
                    aria-label={`Show properties of ${reference.title || "reference"}${
                      drawn ? " — generated" : ""
                    }${onBoard ? " — on this board" : ""}`}
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
                  {/* Top left, the one corner the drag badge and the placement
                      mark leave free — and the mark that is about the picture
                      itself rather than about this board or this drag. */}
                  {drawn ? (
                    <span
                      aria-hidden
                      title="Generated"
                      className="pointer-events-none absolute top-0.5 left-0.5 rounded-full bg-black/65 px-1 text-[9px] leading-4 font-medium text-white"
                    >
                      ✦
                    </span>
                  ) : null}
                  {picked ? (
                    <span className="pointer-events-none absolute top-0.5 right-0.5 rounded-full bg-sky-500 px-1 text-[9px] leading-4 font-medium text-white">
                      {dropOrder.indexOf(reference.id) + 1}
                    </span>
                  ) : null}
                  {/* Bottom left, opposite the drag badge: a photo can be both
                      picked for the next drop and already on the board, and the
                      second is exactly what would make the user reconsider
                      the first. */}
                  {onBoard ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute bottom-0.5 left-0.5 rounded-full bg-black/65 px-1 text-[9px] leading-4 font-medium text-white"
                    >
                      {onBoard === 1 ? "✓" : `${onBoard}×`}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-2 text-[11px] opacity-45">
            {/* The one empty result that is an answer rather than a dead end:
                there is nothing left to place. */}
            {filter.unplacedOnly && !isFilterActive({ ...filter, unplacedOnly: false })
              ? `All ${references.length} references are on this board.`
              : `None of ${references.length} references match.`}
          </p>
        )}

        {selected ? (
          /// Keyed on the tile: the panel walks into a reference's versions and
          /// holds that trail, and a user who picks another photograph in
          /// the strip is starting a new one, not continuing this one.
          <ReferencePropertiesPanel
            key={selected.id}
            projectId={projectId}
            reference={selected}
            onClose={close}
          />
        ) : null}
      </div>
    </div>
  );
}

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
import { useBoardPlacementStore } from "../../_reference/stores/use-board-placement-store";
import { inspectReference, useInspectionStore } from "../../_reference/stores/use-inspection-store";
import { ReferencePropertiesPanel } from "../../_reference/components/reference-properties-panel";

const POLL_MS = 4000;

type SidebarReference = { id: string; width: number | null; height: number | null };

function dragItem(list: Element | null, reference: SidebarReference) {
  return referenceDragItem(
    reference,
    list?.querySelector<HTMLImageElement>(`img[data-reference-id="${CSS.escape(reference.id)}"]`),
  );
}

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

export function SidebarGallery({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const { data: references } = useQuery(
    trpc.reference.listByProject.queryOptions({ projectId }),
  );
  const selectedId = useInspectionStore((state) => state.inspectedId);
  const [dragSelection, setDragSelection] = useState<string[]>([]);
  const [rawFilter, setFilter] = useState<ReferenceFilter>(NO_REFERENCE_FILTER);
  const [isTagsOpen, setIsTagsOpen] = useState(false);

  const placement = useBoardPlacementStore((state) => state.placement);
  const placed = placement?.counts ?? null;
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

  const dropOrder = shown
    .filter((reference) => dragSelection.includes(reference.id))
    .map((reference) => reference.id);
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
          placeholder={hasGenerated ? "Search title, tag or prompt" : "Search title or tag"}
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
            {filter.unplacedOnly && !isFilterActive({ ...filter, unplacedOnly: false })
              ? `All ${references.length} references are on this board.`
              : `None of ${references.length} references match.`}
          </p>
        )}

        {selected ? (
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

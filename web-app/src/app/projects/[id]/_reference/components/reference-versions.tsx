"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  CROP_ASPECT_IDS,
  EDIT_INTENT_LIMIT,
  LOOSE_SHAPE_IDS,
  looseShapeOf,
  shapeAsked,
  cropBoxOf,
  cropCoverageLabel,
  cropShapeMeasured,
  cropSizeLabel,
  cropSoftOnBoard,
  existingCut,
  relabeledIntent,
  sameCut,
  versionDescendants,
  versionLabel,
  versionNote,
} from "@/lib/references/reference-version";
import {
  REFERENCE_DRAG_MIME,
  encodeReferenceDrag,
  referenceDragItem,
} from "@/lib/canvas/moodboard-drop";
import { referenceUsageIndex, removalUsage, removalUsageSummary } from "@/lib/references/reference-usage";
import { announceReferenceDiscarded } from "../../_events/reference-discarded";
import type { TrailStep } from "@/lib/references/reference-trail";
import { useBoardPlacementStore } from "../stores/use-board-placement-store";
import { useReferenceCrop, type CropStage } from "../hooks/use-crop-reference";
import { RemoveReferenceButton } from "./remove-reference";

const STAGE_LABEL: Record<Exclude<CropStage, "idle">, string> = {
  asking: "Reading the frame…",
  cutting: "Cutting…",
  filing: "Saving…",
};

type ListedVersion = { id: string; width: number | null; height: number | null };

function startVersionDrag(event: React.DragEvent<HTMLElement>, version: ListedVersion) {
  const drawn = event.currentTarget.querySelector("img");
  event.dataTransfer.setData(
    REFERENCE_DRAG_MIME,
    encodeReferenceDrag([referenceDragItem(version, drawn)]),
  );
  event.dataTransfer.effectAllowed = "copy";
}

export function ReferenceVersions({
  projectId,
  referenceId,
  frame,
  onOpen,
  canPlace = true,
  onPoint,
  onPropose,
  focusVersionId,
  onFocusApplied,
}: {
  projectId: string;
  referenceId: string;
  frame?: { width?: number | null; height?: number | null };
  onOpen?: (version: TrailStep) => void;
  canPlace?: boolean;
  onPoint?: (cropBox: number[] | null) => void;
  onPropose?: (cropBox: number[] | null) => void;
  focusVersionId?: string | null;
  onFocusApplied?: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listOptions = trpc.reference.versions.queryOptions({ referenceId });
  const { data: versions } = useQuery(listOptions);
  const queryKey = listOptions.queryKey;
  const { ask, refine, adjust, keep, discard, proposal, stage, moving, error, dismissError } =
    useReferenceCrop({ projectId, referenceId });
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [armedId, setArmedId] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamed, setRenamed] = useState("");
  const markedRow = useRef<HTMLLIElement | null>(null);
  const placed = useBoardPlacementStore((state) => state.placement)?.counts;

  const busy = stage !== "idle";

  useEffect(() => {
    onPropose?.(proposal?.cropBox ?? null);
  }, [onPropose, proposal]);

  const walkedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!focusVersionId || walkedTo.current === focusVersionId) return;
    const wanted = versions?.find((version) => version.id === focusVersionId);
    if (!wanted) return;
    walkedTo.current = focusVersionId;
    markedRow.current?.scrollIntoView({ block: "nearest" });
    onPoint?.(wanted.cropBox);
  }, [focusVersionId, versions, onPoint]);

  const offered = proposal && {
    label: versionLabel({ editIntent: proposal.editIntent }),
    note: versionNote(proposal),
    coverage: cropCoverageLabel(proposal.cropBox),
    size: cropSizeLabel(proposal.cropBox, frame ?? {}),
    soft: cropSoftOnBoard(proposal.cropBox, frame ?? {}),
    repeats: existingCut(proposal.cropBox, versions, { except: proposal.origin?.id }),
    moved: proposal.origin,
    unmoved: proposal.origin ? sameCut(proposal.cropBox, proposal.origin.cropBox) : false,
    aspect: proposal.aspect,
    framed: looseShapeOf(proposal.loose),
    shape: cropShapeMeasured(proposal.cropBox, frame ?? {}),
  };

  const { data: usageSource, isFetching, isError: usageFailed } = useQuery(
    trpc.moodboard.referenceUsage.queryOptions(
      { projectId },
      { enabled: armedId !== null, staleTime: 0 },
    ),
  );
  const usage = useMemo(
    () => (usageSource ? referenceUsageIndex(usageSource) : null),
    [usageSource],
  );
  const { data: versionLinks, isError: versionsFailed } = useQuery(
    trpc.reference.versionLinksByProject.queryOptions(
      { projectId },
      { enabled: armedId !== null },
    ),
  );
  const isChecking =
    isFetching ||
    (usage === null && !usageFailed) ||
    (armedId !== null && !versionLinks && !versionsFailed);
  const armedUsage = useMemo(
    () =>
      armedId
        ? removalUsage(usage, armedId, versionDescendants(versionLinks ?? [], armedId))
        : null,
    [armedId, usage, versionLinks],
  );

  const remove = useMutation(
    trpc.reference.remove.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (current) =>
          current?.filter((version) => version.id !== id),
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot.previous);
      },
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.invalidateQueries({
          queryKey: trpc.reference.versionLinksByProject.queryOptions({ projectId }).queryKey,
        });
      },
    }),
  );

  const relabel = useMutation(
    trpc.reference.relabelVersion.mutationOptions({
      onMutate: async ({ referenceId, editIntent }) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (current) =>
          current?.map((version) =>
            version.id === referenceId ? { ...version, editIntent } : version,
          ),
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot.previous);
      },
      onSettled: async (_data, _error, { referenceId }) => {
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.invalidateQueries({
          queryKey: trpc.reference.summary.queryOptions({ referenceId }).queryKey,
        });
      },
    }),
  );

  return (
    <section className="flex flex-col gap-3 border-t border-current/10 pt-4">
      <h3 className="text-[11px] font-medium tracking-widest uppercase opacity-45">Versions</h3>

      {offered ? (
        <div className="flex flex-col gap-2 rounded-md border border-current/20 p-2.5">
          <span className="text-[11px] font-medium tracking-widest uppercase opacity-45">
            {offered.moved ? "Adjusted crop" : "Proposed crop"}
          </span>
          {offered.moved ? (
            <span className="text-[11px] opacity-60">
              Moved from “{versionLabel(offered.moved)}”
            </span>
          ) : null}
          <span className="text-xs">{offered.label}</span>
          {offered.note ? <span className="text-[11px] opacity-60">{offered.note}</span> : null}
          {offered.coverage ? (
            <span className="text-[11px] opacity-45">
              {offered.aspect ? `Held to ${offered.aspect} — ` : null}
              {!offered.aspect && offered.framed
                ? `Framed ${offered.framed.label.toLowerCase()}${
                    offered.shape ? ` — came out ${offered.shape}` : ""
                  } — `
                : null}
              {offered.coverage}
              {offered.size ? ` — ${offered.size}` : null}
            </span>
          ) : null}
          {offered.soft ? (
            <span className="text-[11px] opacity-60">
              Fewer pixels than the board draws a dropped image with — it will
              look soft there
            </span>
          ) : null}
          {offered.repeats ? (
            <span className="text-[11px] opacity-60">
              Already cut here — “{versionLabel(offered.repeats)}”
            </span>
          ) : null}
          {offered.unmoved && offered.moved ? (
            <span className="text-[11px] opacity-60">
              The box did not move — this is still “{versionLabel(offered.moved)}”
            </span>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void keep()}
              disabled={busy}
              className="rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-40"
            >
              {offered.repeats || offered.unmoved ? "Keep anyway" : "Keep"}
            </button>
            <button
              type="button"
              onClick={() => {
                discard();
                setAdjustment("");
              }}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-xs opacity-60 hover:bg-current/8 hover:opacity-100 disabled:opacity-30"
            >
              Discard
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void refine(adjustment);
              setAdjustment("");
            }}
            className="flex gap-2 border-t border-current/10 pt-2"
          >
            <input
              value={adjustment}
              onChange={(event) => setAdjustment(event.target.value)}
              maxLength={EDIT_INTENT_LIMIT}
              disabled={busy}
              placeholder="Not quite? e.g. tighter, more headroom"
              aria-label="What to change about this box"
              className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || adjustment.trim().length === 0}
              className="shrink-0 rounded-md px-3 py-1.5 text-xs opacity-70 hover:bg-current/8 hover:opacity-100 disabled:opacity-30"
            >
              Adjust
            </button>
          </form>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask(prompt, looseShapeOf(aspect) ? { loose: aspect } : aspect ? { aspect } : {});
            setPrompt("");
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={EDIT_INTENT_LIMIT}
            disabled={busy}
            placeholder="Crop to… e.g. just the hands"
            aria-label="What to crop this reference to"
            className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40 disabled:opacity-50"
          />
          <select
            value={aspect}
            onChange={(event) => setAspect(event.target.value)}
            disabled={busy}
            aria-label="What shape to hold the crop to"
            title="Hold the crop to a format, or frame it loosely"
            className="shrink-0 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value="" className="bg-[var(--background)]">
              Any shape
            </option>
            {CROP_ASPECT_IDS.map((id) => (
              <option key={id} value={id} className="bg-[var(--background)]">
                {id}
              </option>
            ))}
            <optgroup label="Loosely" className="bg-[var(--background)]">
              {LOOSE_SHAPE_IDS.map((id) => (
                <option key={id} value={id} className="bg-[var(--background)]">
                  {looseShapeOf(id)?.label ?? id}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            type="submit"
            disabled={busy || prompt.trim().length === 0}
            className="shrink-0 rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-40"
          >
            Crop
          </button>
        </form>
      )}

      {busy ? (
        <p className="flex items-center gap-2 text-xs opacity-60" aria-live="polite">
          <span className="size-3 animate-spin rounded-full border-2 border-current/25 border-t-current" />
          {stage === "asking" && moving ? "Moving the box…" : STAGE_LABEL[stage]}
        </p>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 text-xs text-red-500">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={dismissError} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </p>
      ) : null}

      {versions && versions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {versions.map((version) => {
            const onBoard = placed?.get(version.id);
            const label = versionLabel(version);
            const note = versionNote(version);
            const shape = shapeAsked(version.editAspect)?.label ?? null;
            const armed = armedId === version.id;
            const adjusting = adjustingId === version.id;
            const renaming = renamingId === version.id;
            const asking = armed || adjusting || renaming;
            const grabbable = canPlace && !asking;
            const marked = focusVersionId === version.id;
            return (
              <li
                key={version.id}
                ref={marked ? markedRow : undefined}
                aria-current={marked || undefined}
                draggable={grabbable}
                onDragStart={(event) => startVersionDrag(event, version)}
                onMouseEnter={() => {
                  onFocusApplied?.();
                  onPoint?.(version.cropBox);
                }}
                onMouseLeave={() => !adjusting && !renaming && onPoint?.(null)}
                onFocus={() => {
                  onFocusApplied?.();
                  onPoint?.(version.cropBox);
                }}
                onBlur={() => !adjusting && !renaming && onPoint?.(null)}
                title={`${label}${onBoard ? " — on this board" : ""}${
                  grabbable ? " — drag onto the moodboard" : ""
                }`}
                className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md text-xs hover:bg-current/5 ${
                  grabbable ? "cursor-grab active:cursor-grabbing" : ""
                } ${
                  marked ? "ring-2 ring-sky-500 ring-offset-1 ring-offset-[var(--background)]" : ""
                }`}
              >
                <button
                  type="button"
                  disabled={!onOpen || asking}
                  onClick={() =>
                    onOpen?.({
                      id: version.id,
                      title: version.title,
                      thumbUrl: version.thumbUrl,
                      label,
                      width: version.width,
                      height: version.height,
                    })
                  }
                  title={onOpen ? `${version.title} — open its properties` : version.title}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left disabled:cursor-default"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={version.thumbUrl}
                    alt={label}
                    loading="lazy"
                    draggable={false}
                    className="size-12 shrink-0 rounded-md object-cover"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{label}</span>
                    {note ? (
                      <span className="truncate text-[11px] opacity-50" title={note}>
                        {note}
                      </span>
                    ) : null}
                  </span>
                </button>
                {shape ? (
                  <span
                    title={`Cut at ${shape}`}
                    className="shrink-0 rounded-full border border-current/20 px-1.5 py-0.5 text-[10px] opacity-55"
                  >
                    {shape}
                  </span>
                ) : null}
                {onBoard ? (
                  <span
                    aria-label="On this board"
                    className="shrink-0 rounded-full bg-current/10 px-1.5 py-0.5 text-[10px] opacity-70"
                  >
                    on board
                  </span>
                ) : null}
                {!proposal && !armed && !renaming && cropBoxOf(version.cropBox) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAdjustingId(adjusting ? null : version.id);
                      setAdjustment("");
                      onPoint?.(adjusting ? null : version.cropBox);
                    }}
                    aria-expanded={adjusting}
                    title={`Ask for “${label}” moved`}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] opacity-55 hover:bg-current/8 hover:opacity-100 disabled:opacity-30"
                  >
                    {adjusting ? "Cancel" : "Adjust"}
                  </button>
                ) : null}
                {!proposal && !armed && !adjusting ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(renaming ? null : version.id);
                      setRenamed(renaming ? "" : version.editIntent);
                      onPoint?.(renaming ? null : version.cropBox);
                    }}
                    aria-expanded={renaming}
                    title={`Rename “${label}”`}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] opacity-55 hover:bg-current/8 hover:opacity-100"
                  >
                    {renaming ? "Cancel" : "Rename"}
                  </button>
                ) : null}
                <RemoveReferenceButton
                  isArmed={armed}
                  isChecking={isChecking}
                  summary={
                    usageFailed || versionsFailed
                      ? "Boards not checked"
                      : armedUsage && removalUsageSummary(armedUsage)
                  }
                  onArm={() => {
                    setArmedId(version.id);
                    setRenamingId(null);
                    setAdjustingId(null);
                  }}
                  onCancel={() => setArmedId(null)}
                  onConfirm={() => {
                    setArmedId(null);
                    const usage = usageFailed || versionsFailed ? null : armedUsage;
                    const cuts = versionLinks
                      ? versionDescendants(versionLinks, version.id).length
                      : undefined;
                    remove.mutate(
                      { id: version.id },
                      {
                        onSuccess: () =>
                          announceReferenceDiscarded({
                            referenceId: version.id,
                            title: label,
                            frameId: referenceId,
                            origin: version.origin,
                            ...(cuts !== undefined && { cuts }),
                            ...(usage && { boards: [...usage.own, ...usage.viaVersions] }),
                          }),
                      },
                    );
                  }}
                />
                {adjusting ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void adjust(
                        {
                          id: version.id,
                          cropBox: version.cropBox,
                          editIntent: version.editIntent,
                          editAspect: version.editAspect,
                        },
                        adjustment,
                      );
                      setAdjustingId(null);
                      setAdjustment("");
                      onPoint?.(null);
                    }}
                    className="flex w-full gap-2 pt-1"
                  >
                    <input
                      value={adjustment}
                      onChange={(event) => setAdjustment(event.target.value)}
                      maxLength={EDIT_INTENT_LIMIT}
                      autoFocus
                      placeholder="What to change — e.g. wider, more headroom"
                      aria-label={`What to change about “${label}”`}
                      className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40"
                    />
                    <button
                      type="submit"
                      disabled={adjustment.trim().length === 0}
                      className="shrink-0 rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-30"
                    >
                      Ask
                    </button>
                  </form>
                ) : null}
                {renaming ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (relabeledIntent(renamed, version)) {
                        relabel.mutate({ referenceId: version.id, editIntent: renamed });
                      }
                      setRenamingId(null);
                      setRenamed("");
                      onPoint?.(null);
                    }}
                    className="flex w-full gap-2 pt-1"
                  >
                    <input
                      value={renamed}
                      onChange={(event) => setRenamed(event.target.value)}
                      maxLength={EDIT_INTENT_LIMIT}
                      autoFocus
                      placeholder="What this cut is — e.g. the sign over the door"
                      aria-label={`What “${label}” is called`}
                      className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8"
                    >
                      Save
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        !busy && (
          <p className="text-xs opacity-45">
            No versions yet. Ask for part of this frame — the box is shown on it for a look before
            the cut is kept here, beside the original.
          </p>
        )
      )}
    </section>
  );
}

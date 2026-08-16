"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { isPendingUpload, neighborId, withFavorite, withPendingUploads } from "@/lib/gallery";
import {
  galleryAnalysisIndex,
  galleryAnalysisView,
  isGalleryAnalysisPending,
} from "@/lib/gallery-analysis";
import { referenceUsageIndex, usageSummary, usingBoards } from "@/lib/reference-usage";
import { AnalysisBadge } from "./analysis-badge";
import { ReferenceLightbox } from "./reference-lightbox";
import { RemoveReferenceButton } from "./remove-reference";
import type { PendingUpload } from "./pending-uploads";

/// Matches the property panel's poll: the grid and an open panel are looking at
/// the same jobs, so a tile that fills in noticeably later than the panel beside
/// it reads as one of them being stuck.
const POLL_MS = 4000;

/// The preview is the dropped file itself, so the tile costs no round trip —
/// the director sees the batch the moment it lands on the dropzone rather than
/// after a signed PUT and a database write.
function PendingTile({ file, previewUrl }: PendingUpload) {
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-dashed border-current/20">
      <div className="relative aspect-[4/3] bg-current/5">
        {previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={previewUrl} alt="" className="h-full w-full object-cover opacity-30" />
        ) : null}
        <span className="absolute inset-0 grid place-items-center text-xs opacity-70">
          Uploading…
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 py-2 text-xs opacity-50">
        <span className="truncate font-medium">{file.name}</span>
      </div>
    </li>
  );
}

export function ReferenceGallery({
  projectId,
  pendingUploads,
}: {
  projectId: string;
  pendingUploads: PendingUpload[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);

  const listOptions = trpc.reference.listByProject.queryOptions({ projectId });
  const { data: references, isPending } = useQuery(listOptions);
  const queryKey = listOptions.queryKey;

  /// One read for every tile's analyzer state, polled only while a tile on
  /// screen can still change — a gallery of finished analyses left open
  /// overnight stops asking.
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
  /// Held back until the first read lands: an empty index reads every reference
  /// as pending, which would flash "Analyzing" across an already analyzed
  /// gallery on every page load.
  const analysis = useMemo(
    () => (analysisSource ? galleryAnalysisIndex(analysisSource) : null),
    [analysisSource],
  );

  /// Only the last mutation standing refetches: a server list fetched while a
  /// sibling toggle is still in flight does not know about that toggle, so
  /// invalidating on every settle flickers the optimistic tile back and forth
  /// when the director stars several images in a row.
  const invalidateGalleryWhenSettled = () => {
    if (queryClient.isMutating() === 1) return queryClient.invalidateQueries({ queryKey });
  };

  /// Both mutations write the cache before the round trip: a favorite toggle
  /// waits on a database write and a removal on two GCS object deletes, which
  /// is long enough for a click to feel unregistered. Cancelling first stops an
  /// in-flight list refetch from landing on top of the optimistic list.
  type Gallery = NonNullable<typeof references>;
  async function optimistically(update: (current: Gallery) => Gallery) {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (current) => (current ? update(current) : current));
    return { previous };
  }

  const rollback = (
    _error: unknown,
    _input: unknown,
    snapshot: { previous: Gallery | undefined } | undefined,
  ) => {
    if (snapshot) queryClient.setQueryData(queryKey, snapshot.previous);
  };

  const setFavorite = useMutation(
    trpc.reference.setFavorite.mutationOptions({
      onMutate: ({ id, isFavorite }) =>
        optimistically((current) => withFavorite(current, id, isFavorite)),
      onError: rollback,
      onSettled: invalidateGalleryWhenSettled,
    }),
  );
  const remove = useMutation(
    trpc.reference.remove.mutationOptions({
      onMutate: ({ id }) =>
        optimistically((current) => current.filter((reference) => reference.id !== id)),
      onError: rollback,
      onSettled: invalidateGalleryWhenSettled,
    }),
  );

  /// Removing the reference the viewer is showing lands on its neighbour rather
  /// than closing — the neighbour has to be picked before the row goes.
  function removeReference(reference: { id: string }) {
    setArmedId(null);
    if (openId === reference.id) setOpenId(neighborId(references ?? [], openId, 1));
    remove.mutate({ id: reference.id });
  }

  /// One tile at a time is armed, so the board scan is read once for the
  /// gallery rather than by every tile that renders — and not at all until a
  /// removal is actually being considered.
  ///
  /// `staleTime: 0` against the client's 30 s default: a board is rewritten by
  /// its autosave every time the director moves a photo, so a cached answer from
  /// half a minute ago can miss exactly the board that was just built. Arming
  /// the removal is a rare, deliberate act — it can pay for a round trip.
  const { data: usageSource, isFetching, isError: usageFailed } = useQuery(
    trpc.moodboard.referenceUsage.queryOptions(
      { projectId },
      { enabled: armedId !== null, staleTime: 0 },
    ),
  );
  const usage = useMemo(() => (usageSource ? referenceUsageIndex(usageSource) : null), [usageSource]);

  /// A failed scan does not become a reference that cannot be deleted: the
  /// removal is offered with the warning it could not make. A scan still in
  /// flight does hold it, because a removal that raced the check is the
  /// unguarded click this exists to remove.
  const isChecking = isFetching || (usage === null && !usageFailed);

  function removeControl(reference: { id: string }) {
    return (
      <RemoveReferenceButton
        isArmed={armedId === reference.id}
        isChecking={isChecking}
        summary={usageFailed ? "Boards not checked" : usageSummary(usingBoards(usage, reference.id))}
        onArm={() => setArmedId(reference.id)}
        onCancel={() => setArmedId(null)}
        onConfirm={() => removeReference(reference)}
      />
    );
  }

  if (isPending) return <p className="text-sm opacity-60">Loading references…</p>;

  if (!references?.length && !pendingUploads.length) {
    return <p className="text-sm opacity-60">No references yet. Upload the images you want to work from.</p>;
  }

  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {withPendingUploads(references ?? [], pendingUploads).map((tile) => {
          if (isPendingUpload(tile)) return <PendingTile key={tile.pendingKey} {...tile} />;
          const reference = tile;

          return (
            <li
            key={reference.id}
            className="flex flex-col overflow-hidden rounded-xl border border-current/10"
          >
            <div className="relative aspect-[4/3] bg-current/5">
              {/* The star sits beside this button, not inside it — a button
                  nested in a button is invalid and swallows the click. */}
              <button
                type="button"
                onClick={() => setOpenId(reference.id)}
                aria-label={`Open ${reference.title || "reference"} full size`}
                className="block h-full w-full cursor-zoom-in"
              >
                {/* next/image fetches the source through the optimizer, which
                    carries no session cookie — every tile would 404. The
                    downscaled copy is why a 220px tile is not a 5MB download. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reference.thumbUrl}
                  alt={reference.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  setFavorite.mutate({ id: reference.id, isFavorite: !reference.isFavorite })
                }
                aria-pressed={reference.isFavorite}
                aria-label={reference.isFavorite ? "Remove from favorites" : "Add to favorites"}
                className="absolute top-2 right-2 rounded-full bg-[var(--background)]/85 px-2 py-1 text-sm leading-none"
              >
                {reference.isFavorite ? "★" : "☆"}
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-1 px-3 py-2 text-xs">
              {reference.title ? <span className="font-medium">{reference.title}</span> : null}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                {/* Always rendered, even empty: it is what keeps Remove on the
                    right when a tile has nothing to say about its analysis. */}
                <div className="min-w-0">
                  {analysis ? <AnalysisBadge view={galleryAnalysisView(analysis, reference.id)} /> : null}
                </div>
                {removeControl(reference)}
              </div>
            </div>
            </li>
          );
        })}
      </ul>

      <ReferenceLightbox
        references={references ?? []}
        openId={openId}
        onOpen={setOpenId}
        onToggleFavorite={(reference) =>
          setFavorite.mutate({ id: reference.id, isFavorite: !reference.isFavorite })
        }
        renderRemove={removeControl}
      />
    </>
  );
}

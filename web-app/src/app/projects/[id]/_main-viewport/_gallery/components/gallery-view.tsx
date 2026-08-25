"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { isPendingUpload, neighborId, withFavorite, withPendingUploads } from "@/lib/references/gallery";
import {
  galleryAnalysisIndex,
  galleryAnalysisView,
  isGalleryAnalysisPending,
} from "@/lib/analysis/gallery-analysis";
import { referenceUsageIndex, removalUsage, removalUsageSummary } from "@/lib/references/reference-usage";
import type { ReferenceOrigin } from "@/generated/prisma/enums";
import { announceReferenceDiscarded } from "../../../_events/reference-discarded";
import type { DiscardedReference } from "@/lib/references/reference-discard";
import {
  versionCountIndex,
  versionCountLabel,
  versionDescendants,
} from "@/lib/references/reference-version";
import { inspectReference } from "../../../_reference/stores/use-inspection-store";
import { GalleryLightbox } from "./gallery-lightbox";
import { GalleryTile } from "./gallery-tile";
import { PendingTile } from "./pending-tile";
import { RemoveReferenceButton } from "../../../_reference/components/remove-reference";
import { openSidebar } from "../../../_workspace/stores/use-sidebar-store";
import { usePendingUploadsStore } from "../stores/use-pending-uploads-store";

/// Matches the property panel's poll: the grid and an open panel are looking at
/// the same jobs, so a tile that fills in noticeably later than the panel beside
/// it reads as one of them being stuck.
const POLL_MS = 4000;

export function GalleryView({ projectId }: { projectId: string }) {
  /// The batch the dropzone above is still uploading, read from the store the
  /// two of them share rather than handed down: the workspace between them has
  /// no other reason to know an upload is happening.
  const pendingUploads = usePendingUploadsStore((state) => state.pending);
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

  /// The cuts of this project and what each was cut from. The grid does not show
  /// a version — a crop is not a second photo of the project — but it has to say
  /// that one exists, or a frame that was cropped looks exactly like a frame that
  /// never was, and the panel holding the crops is a place the user has to
  /// already know to go. The same read tells a removal what it would take down
  /// with the frame.
  const { data: versionLinks, isError: versionsFailed } = useQuery(
    trpc.reference.versionLinksByProject.queryOptions({ projectId }),
  );
  const versionCounts = useMemo(() => versionCountIndex(versionLinks ?? []), [versionLinks]);

  /// The way from the count to the list it counts. The panel is rendered by the
  /// sidebar's own strip in the other column, so opening it from here is a
  /// published selection — and the sidebar has to be open for there to be a
  /// panel at all.
  function openProperties(referenceId: string) {
    openSidebar();
    inspectReference(referenceId);
  }

  /// Only the last mutation standing refetches: a server list fetched while a
  /// sibling toggle is still in flight does not know about that toggle, so
  /// invalidating on every settle flickers the optimistic tile back and forth
  /// when the user stars several images in a row.
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
  ///
  /// And the conversation is told, because the chat may be holding a tile of this
  /// picture — from a `show_references`, or from the Remove offer this control is
  /// the other door to. Announced on success rather than on the click: a removal
  /// that did not land is not one, and the optimistic tile comes back.
  ///
  /// What is *known* is announced and what is not is left out: a board scan that
  /// failed means unknown boards rather than none, and the note says nothing
  /// about them instead of claiming the picture was on none.
  function removeReference(reference: { id: string; title: string }, gone: DiscardedReference) {
    setArmedId(null);
    if (openId === reference.id) setOpenId(neighborId(references ?? [], openId, 1));
    remove.mutate({ id: reference.id }, { onSuccess: () => announceReferenceDiscarded(gone) });
  }

  /// One tile at a time is armed, so the board scan is read once for the
  /// gallery rather than by every tile that renders — and not at all until a
  /// removal is actually being considered.
  ///
  /// `staleTime: 0` against the client's 30 s default: a board is rewritten by
  /// its autosave every time the user moves a photo, so a cached answer from
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
  /// unguarded click this exists to remove — and the cuts of the frame are half
  /// of that check now, so a confirm offered before they land is a warning that
  /// silently leaves out every board a crop is on.
  const isChecking =
    isFetching ||
    (usage === null && !usageFailed) ||
    (armedId !== null && !versionLinks && !versionsFailed);

  /// Read for the armed tile alone: the warning is only shown on that one, and
  /// walking the project's cuts for every tile in the grid on every render would
  /// be the whole list per photo to answer a question about one.
  const armedUsage = useMemo(
    () =>
      armedId
        ? removalUsage(usage, armedId, versionDescendants(versionLinks ?? [], armedId))
        : null,
    [armedId, usage, versionLinks],
  );

  function removeControl(reference: { id: string; title: string; origin?: ReferenceOrigin | null }) {
    return (
      <RemoveReferenceButton
        isArmed={armedId === reference.id}
        isChecking={isChecking}
        /// Either read failing leaves the same question unanswered: without the
        /// boards there is nothing to name, and without the cuts the boards
        /// named are only the ones showing the photograph itself.
        summary={
          usageFailed || versionsFailed
            ? "Boards not checked"
            : armedUsage && removalUsageSummary(armedUsage)
        }
        onArm={() => setArmedId(reference.id)}
        onCancel={() => setArmedId(null)}
        /// What is *known* is announced and what is not is left out: a board scan
        /// that failed means unknown boards rather than none, and the note then
        /// says nothing about them instead of claiming the picture was on none.
        onConfirm={() => {
          const scanned = usageFailed || versionsFailed ? null : armedUsage;
          removeReference(reference, {
            referenceId: reference.id,
            title: reference.title,
            ...(versionLinks && { cuts: versionDescendants(versionLinks, reference.id).length }),
            ...(scanned && { boards: [...scanned.own, ...scanned.viaVersions] }),
            /// What it was, said in the note the conversation reads: the grid is
            /// where a drawn backdrop lives beside the photographs, and by the
            /// time the sentence is written the row is deleted.
            origin: reference.origin,
          });
        }}
      />
    );
  }

  if (isPending) return <p className="text-sm opacity-60">Loading references…</p>;

  if (!references?.length && !pendingUploads.length) {
    return (
      <p className="text-sm opacity-60">
        No references yet. Upload the images you want to work from, or ask the assistant for a
        texture, a gradient or a backdrop and it draws one.
      </p>
    );
  }

  return (
    <>
      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 overflow-y-auto">
        {withPendingUploads(references ?? [], pendingUploads).map((tile) => {
          if (isPendingUpload(tile)) return <PendingTile key={tile.pendingKey} {...tile} />;
          const reference = tile;

          return (
            <GalleryTile
              key={reference.id}
              reference={reference}
              analysis={analysis ? galleryAnalysisView(analysis, reference.id) : null}
              crops={versionCountLabel(versionCounts.get(reference.id))}
              onOpen={() => setOpenId(reference.id)}
              onToggleFavorite={() =>
                setFavorite.mutate({ id: reference.id, isFavorite: !reference.isFavorite })
              }
              onOpenProperties={() => openProperties(reference.id)}
              remove={removeControl(reference)}
            />
          );
        })}
      </ul>

      <GalleryLightbox
        projectId={projectId}
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

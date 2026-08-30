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

const POLL_MS = 4000;

export function GalleryView({ projectId }: { projectId: string }) {
  const pendingUploads = usePendingUploadsStore((state) => state.pending);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);

  const listOptions = trpc.reference.listByProject.queryOptions({ projectId });
  const { data: references, isPending } = useQuery(listOptions);
  const queryKey = listOptions.queryKey;

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
  const analysis = useMemo(
    () => (analysisSource ? galleryAnalysisIndex(analysisSource) : null),
    [analysisSource],
  );

  const { data: versionLinks, isError: versionsFailed } = useQuery(
    trpc.reference.versionLinksByProject.queryOptions({ projectId }),
  );
  const versionCounts = useMemo(() => versionCountIndex(versionLinks ?? []), [versionLinks]);

  function openProperties(referenceId: string) {
    openSidebar();
    inspectReference(referenceId);
  }

  const invalidateGalleryWhenSettled = () => {
    if (queryClient.isMutating() === 1) return queryClient.invalidateQueries({ queryKey });
  };

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

  function removeReference(reference: { id: string; title: string }, gone: DiscardedReference) {
    setArmedId(null);
    if (openId === reference.id) setOpenId(neighborId(references ?? [], openId, 1));
    remove.mutate({ id: reference.id }, { onSuccess: () => announceReferenceDiscarded(gone) });
  }

  const { data: usageSource, isFetching, isError: usageFailed } = useQuery(
    trpc.moodboard.referenceUsage.queryOptions(
      { projectId },
      { enabled: armedId !== null, staleTime: 0 },
    ),
  );
  const usage = useMemo(() => (usageSource ? referenceUsageIndex(usageSource) : null), [usageSource]);

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

  function removeControl(reference: { id: string; title: string; origin?: ReferenceOrigin | null }) {
    return (
      <RemoveReferenceButton
        isArmed={armedId === reference.id}
        isChecking={isChecking}
        summary={
          usageFailed || versionsFailed
            ? "Boards not checked"
            : armedUsage && removalUsageSummary(armedUsage)
        }
        onArm={() => setArmedId(reference.id)}
        onCancel={() => setArmedId(null)}
        onConfirm={() => {
          const scanned = usageFailed || versionsFailed ? null : armedUsage;
          removeReference(reference, {
            referenceId: reference.id,
            title: reference.title,
            ...(versionLinks && { cuts: versionDescendants(versionLinks, reference.id).length }),
            ...(scanned && { boards: [...scanned.own, ...scanned.viaVersions] }),
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

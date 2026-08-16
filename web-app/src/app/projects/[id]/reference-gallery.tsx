"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { neighborId } from "@/lib/gallery";
import { ReferenceLightbox } from "./reference-lightbox";

export function ReferenceGallery({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const listOptions = trpc.reference.listByProject.queryOptions({ projectId });
  const { data: references, isPending } = useQuery(listOptions);

  const invalidateGallery = () =>
    queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

  const setFavorite = useMutation(
    trpc.reference.setFavorite.mutationOptions({ onSuccess: invalidateGallery }),
  );
  const remove = useMutation(
    trpc.reference.remove.mutationOptions({ onSuccess: invalidateGallery }),
  );

  /// Removing the reference the viewer is showing lands on its neighbour rather
  /// than closing — the neighbour has to be picked before the row goes.
  function removeReference(reference: { id: string }) {
    if (openId === reference.id) setOpenId(neighborId(references ?? [], openId, 1));
    remove.mutate({ id: reference.id });
  }

  if (isPending) return <p className="text-sm opacity-60">Loading references…</p>;

  if (!references?.length) {
    return <p className="text-sm opacity-60">No references yet. Upload the images you want to work from.</p>;
  }

  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {references.map((reference) => (
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
              <div className="mt-auto flex justify-end pt-1 opacity-50">
                <button
                  type="button"
                  onClick={() => removeReference(reference)}
                  className="hover:opacity-100"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <ReferenceLightbox
        references={references}
        openId={openId}
        onOpen={setOpenId}
        onToggleFavorite={(reference) =>
          setFavorite.mutate({ id: reference.id, isFavorite: !reference.isFavorite })
        }
        onRemove={removeReference}
      />
    </>
  );
}

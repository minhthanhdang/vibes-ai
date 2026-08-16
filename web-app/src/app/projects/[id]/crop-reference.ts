"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { hashFileContent } from "@/lib/content-hash";
import { editIntent } from "@/lib/reference-version";
import { cutFromOriginal } from "./cut-reference";
import { uploadVersion } from "./upload-reference";

/// Agent 3, end to end: the director says what they want out of a frame and a
/// version of it exists.
///
/// Three moves, and they are in three places on purpose. The *plan* is a vision
/// call and belongs on the server, where the key is; the *cut* is a canvas and
/// belongs in the browser, which is the only place this app has one (§II.6); the
/// *row* is what makes those bytes a version rather than a photo. This is the
/// seam between them, and it is a hook rather than a mutation because the middle
/// step is neither a query nor a request.
///
/// Nothing is stored until all three land. A plan the cut cannot be made from
/// costs one call and leaves the project exactly as it was.

export type CropStage = "idle" | "asking" | "cutting" | "filing";

export function useReferenceCrop({
  projectId,
  referenceId,
}: {
  projectId: string;
  referenceId: string;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<CropStage>("idle");
  const [error, setError] = useState<string | null>(null);
  /// The guard is a ref, not the stage: a second submit races the render that
  /// would have disabled the button, and two crops of one prompt are two
  /// vision calls and two rows.
  const running = useRef(false);

  const crop = useCallback(
    async (prompt: string) => {
      const asked = editIntent(prompt);
      if (!asked || running.current) return;

      running.current = true;
      setError(null);
      setStage("asking");
      try {
        const plan = await client.reference.planCrop.mutate({ referenceId, prompt: asked });

        setStage("cutting");
        const cut = await cutFromOriginal(referenceId, plan.region);
        /// A browser with no `OffscreenCanvas`, or a file it cannot decode.
        /// Said rather than swallowed: the crop was asked for and the answer is
        /// that this browser cannot make it.
        if (!cut) throw new Error("this browser could not cut the image");

        setStage("filing");
        await uploadVersion(client, projectId, {
          file: cut.file,
          contentType: cut.contentType,
          /// The same digest every other upload stores, so a crop and a photo
          /// of the same bytes are recognisable as one thing.
          contentHash: await hashFileContent(cut.file),
          sourceReferenceId: referenceId,
          /// The cropper's own wording when it gave one, the director's when it
          /// did not — the label of a cut is what it was asked for.
          editIntent: plan.editIntent || asked,
          /// Why the box is where it is, kept on the row: the run that recorded
          /// it names no version, so a plan whose reasoning stops here is a cut
          /// nobody can ever ask that of.
          editRationale: plan.editRationale,
          cropBox: plan.cropBox,
        });

        await queryClient.invalidateQueries({
          queryKey: trpc.reference.versions.queryOptions({ referenceId }).queryKey,
        });
        /// The gallery list itself is unchanged — a cut is not a photograph of
        /// the project — but what the grid says about this frame is: the tile
        /// counts the cuts of it, and one more was just made.
        await queryClient.invalidateQueries({
          queryKey: trpc.reference.versionCountsByProject.queryOptions({ projectId }).queryKey,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        running.current = false;
        setStage("idle");
      }
    },
    [client, projectId, queryClient, referenceId, trpc],
  );

  return { crop, stage, error, dismissError: useCallback(() => setError(null), []) };
}

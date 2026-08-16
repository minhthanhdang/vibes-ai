"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { hashFileContent } from "@/lib/content-hash";
import { editIntent } from "@/lib/reference-version";
import type { CropRegion } from "@/lib/moodboard-crop";
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
/// The director stands in that seam. `planCrop` answers with four numbers and
/// nothing has been cut, uploaded, analyzed or filed yet — so the box is offered
/// for a look before it becomes a row, which is exactly what the server's own
/// note meant by "a plan the director does not take costs nothing but the call".
/// A cut nobody wanted was the commonest thing this agent produced, and taking
/// every plan meant answering it with a delete: two more uploads, an analyzer
/// job and two bucket objects, all to undo a box that could have been read in a
/// second.
///
/// Nothing is stored until all three land. A plan the cut cannot be made from
/// leaves the project exactly as it was.

export type CropStage = "idle" | "asking" | "cutting" | "filing";

/// The cut that would exist, before it does: the region to take, the columns
/// that would say which part of the frame it is, and the two lines — what was
/// asked for and what the cropper made of the asking — that the review is read
/// from and the row is filed under.
export type CropProposal = {
  region: CropRegion;
  cropBox: number[];
  editIntent: string;
  editRationale: string;
};

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
  const [proposal, setProposal] = useState<CropProposal | null>(null);
  /// The guard is a ref, not the stage: a second submit races the render that
  /// would have disabled the button, and two crops of one prompt are two
  /// vision calls and two rows.
  const running = useRef(false);

  const ask = useCallback(
    async (prompt: string) => {
      const asked = editIntent(prompt);
      if (!asked || running.current) return;

      running.current = true;
      setError(null);
      setStage("asking");
      try {
        const plan = await client.reference.planCrop.mutate({ referenceId, prompt: asked });
        setProposal({
          region: plan.region,
          cropBox: plan.cropBox,
          /// The cropper's own wording when it gave one, the director's when it
          /// did not — the label of a cut is what it was asked for.
          editIntent: plan.editIntent || asked,
          /// Why the box is where it is. Read here first, where it still buys a
          /// decision: this is the only place the cropper says that what was
          /// asked for is not in this frame and the box is the nearest thing.
          editRationale: plan.editRationale,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        running.current = false;
        setStage("idle");
      }
    },
    [client, referenceId],
  );

  const keep = useCallback(async () => {
    if (!proposal || running.current) return;

    running.current = true;
    setError(null);
    setStage("cutting");
    try {
      const cut = await cutFromOriginal(referenceId, proposal.region);
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
        editIntent: proposal.editIntent,
        /// Kept on the row: the run that recorded it names no version, so
        /// reasoning that stops at the review is a filed cut nobody can ever
        /// ask that of afterwards.
        editRationale: proposal.editRationale,
        cropBox: proposal.cropBox,
      });
      setProposal(null);

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
  }, [client, projectId, proposal, queryClient, referenceId, trpc]);

  /// Declining costs the call that was already made and nothing else — no bytes,
  /// no row, no analyzer job, nothing to delete afterwards.
  const discard = useCallback(() => {
    if (running.current) return;
    setProposal(null);
    setError(null);
  }, []);

  return {
    ask,
    keep,
    discard,
    proposal,
    stage,
    error,
    dismissError: useCallback(() => setError(null), []),
  };
}

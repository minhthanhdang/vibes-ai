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
///
/// Standing in that seam is also where the crop gets *asked for* properly. A
/// first box is rarely the shot, and what is wrong with it is almost never a new
/// description of the photograph — it is a nudge about the box on screen. So the
/// offer can be asked again with itself attached (`refine`), and the loop runs
/// on the plan rather than on the versions list: adjusting costs a call, while
/// adjusting by keeping and re-cropping costs a row, its bytes, its thumbnail,
/// its analysis and the delete that follows.
///
/// A cut that was already taken can be moved the same way (`adjust`). It is the
/// same call with the row's own box attached instead of the offer's, because to
/// the cropper a box is a box — and it is what a director asking for a filed cut
/// "a little wider" actually means. The alternative they had was cropping the
/// cut, which can only ever take less of the photograph than the cut already
/// holds.

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
  /// The filed cut this offer was moved from, when the ask started at a row
  /// rather than at the frame. Carried so the review can measure the answer
  /// against the cut it is meant to improve on: an offer that overlaps that row
  /// is not a duplicate to warn about — it is the adjustment — and one that
  /// overlaps it *entirely* is a nudge the model ignored.
  origin: CropOrigin | null;
};

/// A cut that already exists, as the box an adjustment starts from. The row's
/// own columns and label, which is exactly what `planCrop` takes as `previous`:
/// to the cropper there is no difference between moving a box it just answered
/// with and moving one filed a week ago.
export type CropOrigin = { id: string; cropBox: number[]; editIntent: string };

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
  /// Whether the ask that is out has a box behind it. The two calls are the same
  /// call and take the same seconds, but one is reading a photograph and the
  /// other is moving a rectangle, and the wait says which — a filed cut being
  /// adjusted has no offer on screen to tell them apart by.
  const [moving, setMoving] = useState(false);
  /// The guard is a ref, not the stage: a second submit races the render that
  /// would have disabled the button, and two crops of one prompt are two
  /// vision calls and two rows.
  const running = useRef(false);

  /// One ask, with or without the box it is about. `previous` is the box being
  /// moved — the offer on screen, or a cut already filed under this frame: a
  /// director reading a box answers it with a nudge — tighter, more headroom —
  /// and a nudge sent alone is a fresh reading of the frame that comes back as
  /// some other shot entirely.
  const ask = useCallback(
    async (
      prompt: string,
      previous?: { cropBox: number[]; editIntent: string },
      origin: CropOrigin | null = null,
    ) => {
      const asked = editIntent(prompt);
      if (!asked || running.current) return;

      running.current = true;
      setError(null);
      setMoving(!!previous);
      setStage("asking");
      try {
        const plan = await client.reference.planCrop.mutate({
          referenceId,
          prompt: asked,
          ...(previous && {
            previous: { cropBox: previous.cropBox, editIntent: previous.editIntent },
          }),
        });
        setProposal({
          region: plan.region,
          cropBox: plan.cropBox,
          /// The cropper's own wording when it gave one, the director's when it
          /// did not — the label of a cut is what it was asked for. On an
          /// adjustment the server has already composed it out of the label of
          /// the box being moved and the nudge that moved it, since "tighter"
          /// names no part of a photograph and the row this was moved from is
          /// still in the list under a label of its own.
          editIntent: plan.editIntent || asked,
          /// Why the box is where it is. Read here first, where it still buys a
          /// decision: this is the only place the cropper says that what was
          /// asked for is not in this frame and the box is the nearest thing.
          editRationale: plan.editRationale,
          origin,
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
        queryKey: trpc.reference.versionLinksByProject.queryOptions({ projectId }).queryKey,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      running.current = false;
      setStage("idle");
    }
  }, [client, projectId, proposal, queryClient, referenceId, trpc]);

  /// Asking again about the box that is on screen. The offer stays up while the
  /// call is out — it is the thing being adjusted, and a frame that goes blank
  /// mid-adjustment takes away what the director is comparing the answer to —
  /// and a failed adjustment leaves the offer they already had standing.
  const refine = useCallback(
    async (prompt: string) => {
      if (!proposal) return;
      /// The origin rides along: a box moved twice is still an adjustment of the
      /// row it started at, and the review measures every answer against that
      /// row rather than against the answer before it.
      await ask(prompt, proposal, proposal.origin);
    },
    [ask, proposal],
  );

  /// The same adjustment, started at a cut that already exists.
  ///
  /// A filed row is a box like any other, and the commonest thing wrong with one
  /// is what was already wrong with the first offer: it wants moving. Without
  /// this the only way to widen a cut is to ask the frame again from nothing —
  /// a fresh reading that answers some other shot — or to crop the cut itself,
  /// which can only ever take *less* of the photograph than the cut already has.
  ///
  /// It files nothing and touches nothing: the row is the box the ask starts
  /// from, and what comes back is an offer to be taken or declined like any
  /// other. The original stays exactly where it is — the review names it, so a
  /// director who meant to replace it can delete it once the new cut is filed.
  const adjust = useCallback(
    async (version: CropOrigin, prompt: string) => {
      await ask(prompt, { cropBox: version.cropBox, editIntent: version.editIntent }, version);
    },
    [ask],
  );

  /// Declining costs the call that was already made and nothing else — no bytes,
  /// no row, no analyzer job, nothing to delete afterwards.
  const discard = useCallback(() => {
    if (running.current) return;
    setProposal(null);
    setError(null);
  }, []);

  return {
    ask,
    refine,
    adjust,
    keep,
    discard,
    proposal,
    stage,
    moving,
    error,
    dismissError: useCallback(() => setError(null), []),
  };
}

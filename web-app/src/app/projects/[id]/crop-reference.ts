"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { hashFileContent } from "@/lib/intake/content-hash";
import { editIntent, shapeAsked } from "@/lib/references/reference-version";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import { cutFromOriginal } from "./cut-reference";
import { announceCutTaken } from "./cut-taken";
import { uploadVersion } from "./upload-reference";

/// Agent 3, end to end: the user says what they want out of a frame and a
/// version of it exists.
///
/// Three moves, and they are in three places on purpose. The *plan* is a vision
/// call and belongs on the server, where the key is; the *cut* is a canvas, on
/// bytes this column already has on screen; the *row* is what makes those bytes
/// a version rather than a photo. This is the seam between them, and it is a
/// hook rather than a mutation because the middle step is neither a query nor a
/// request.
///
/// The server can cut too now — `crop_reference` decodes and files in the one
/// call — and this path deliberately does not use it. A box the user is looking
/// at is cut where they are looking at it: the original never leaves the bucket
/// for a cut nobody has agreed to yet.
///
/// The user stands in that seam. `planCrop` answers with four numbers and
/// nothing has been cut, uploaded, analyzed or filed yet — so the box is offered
/// for a look before it becomes a row, which is exactly what the server's own
/// note meant by "a plan the user does not take costs nothing but the call".
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
/// An ask can also name the *shape* the cut is to be, which is the other thing a
/// user wants out of a frame while composing: this, at scope. The ratio is
/// enforced on the server — it is a ratio of the frame's pixels, and the box the
/// model answers in is a share of each edge — and it rides on the offer, so a
/// nudge about that box is asked at the same format rather than dropping it. It
/// rides onto the row when the cut is taken as well, because the pixels cannot
/// say it afterwards — the box is a share of each edge of a frame that is not
/// square, and the ratio survives the round trip only to within the rounding.
///
/// The shape can also be said as a *word* — square, portrait — which is not a
/// quieter way of naming a ratio but a different instruction: the box the cropper
/// answers with is the cut, and the word is a band it has to land inside rather
/// than a number it is opened out to. It travels every path the ratio does below,
/// because everywhere the shape is only being carried the two are one thing: drop
/// it at any of them and a user who asked for a square is answered with a
/// rectangle by the very next nudge.
///
/// A cut that was already taken can be moved the same way (`adjust`). It is the
/// same call with the row's own box attached instead of the offer's, because to
/// the cropper a box is a box — and it is what a user asking for a filed cut
/// "a little wider" actually means. The alternative they had was cropping the
/// cut, which can only ever take less of the photograph than the cut already
/// holds. That row's own format goes with its box: a cut filed at scope is
/// nudged at scope, or it stops being the shape the board was cut to.

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
  /// The shape this box was held to, when the user asked for one. Carried so
  /// the review can say so — a box at a format is a different offer from a box
  /// around a subject — and so a nudge about it is asked at the same shape: an
  /// adjustment that quietly dropped the ratio would answer "wider" with a crop
  /// that is no longer the format the first one was asked for.
  ///
  /// A label rather than one of the six names the form offers: a cut the
  /// assistant made for a board is held to that slot's exact shape (§V), and a
  /// nudge of it has to be asked at the same shape or it stops being the cut the
  /// board is waiting for.
  aspect: string | null;
  /// The loose shape it was framed as, when the user named a shape without
  /// naming a number. Beside `aspect` rather than sharing it, because the two are
  /// different promises — what the cut *is*, to two decimal places, against what
  /// it was framed for — and every path below has to carry whichever arrived: a
  /// nudge that dropped the band would answer "a little tighter" with a cut that
  /// is no longer the shape they asked for, exactly as dropping a ratio would.
  loose: string | null;
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
///
/// `editAspect` is the format the row was cut at, straight off the column and
/// unvalidated here — the shape a nudge about that row has to be asked at.
export type CropOrigin = {
  id: string;
  cropBox: number[];
  editIntent: string;
  editAspect?: unknown;
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
  /// user reading a box answers it with a nudge — tighter, more headroom —
  /// and a nudge sent alone is a fresh reading of the frame that comes back as
  /// some other shot entirely.
  const ask = useCallback(
    async (
      prompt: string,
      {
        previous,
        origin = null,
        aspect = null,
        loose = null,
      }: {
        previous?: { cropBox: number[]; editIntent: string };
        origin?: CropOrigin | null;
        /// The format the cut is to be held to. Enforced on the server, where the
        /// frame's pixels are — a ratio in 0-1000 units is not a ratio.
        aspect?: string | null;
        /// The band the cut is to be framed inside, when the shape was said as a
        /// word. Told to the model rather than enforced on its answer, which is
        /// the whole difference between the two.
        loose?: string | null;
      } = {},
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
          ...(aspect && { aspect }),
          ...(loose && { loose }),
        });
        setProposal({
          region: plan.region,
          cropBox: plan.cropBox,
          /// The cropper's own wording when it gave one, the user's when it
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
          aspect,
          /// The band as it was asked, not as the server read it back: the plan
          /// echoes it, and the two agreeing is what `loose` on the plan is for.
          loose: plan.loose ?? loose,
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
      const filed = await uploadVersion(client, projectId, {
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
        /// The shape this box was held to, kept on the row: the box alone cannot
        /// say it afterwards, and it is what a later nudge about this cut has to
        /// be asked at. Or the word it was framed as, in the same column — a
        /// loosely framed cut lands at an exact ratio like any other, so its
        /// pixels answer "what shape is it" and can never answer "what was
        /// asked".
        ...((proposal.aspect ?? proposal.loose) && {
          editAspect: proposal.aspect ?? proposal.loose ?? undefined,
        }),
      });

      /// Said into the conversation, which cannot see this column. The assistant
      /// files its own cuts and knows about those; a cut framed by hand here is
      /// the one it would otherwise have to buy a `list_references` round to find
      /// — and would still be guessing which of the cuts under that frame is the
      /// one that just appeared.
      announceCutTaken({
        referenceId: filed.id,
        frameId: referenceId,
        title: filed.title,
        keeps: proposal.editIntent,
        aspect: proposal.aspect,
        /// Said apart from the ratio for the same reason the proposal carries it
        /// apart: the review card told the user this cut was framed square, and a
        /// note that only ever names ratios says nothing at all about the one
        /// thing they asked for.
        framed: proposal.loose,
        thumbUrl: filed.thumbUrl,
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
  /// mid-adjustment takes away what the user is comparing the answer to —
  /// and a failed adjustment leaves the offer they already had standing.
  const refine = useCallback(
    async (prompt: string) => {
      if (!proposal) return;
      /// The origin rides along: a box moved twice is still an adjustment of the
      /// row it started at, and the review measures every answer against that
      /// row rather than against the answer before it. So does the shape — a
      /// nudge is about where the edges of this format sit, not about giving it
      /// up.
      await ask(prompt, {
        previous: proposal,
        origin: proposal.origin,
        aspect: proposal.aspect,
        loose: proposal.loose,
      });
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
  /// user who meant to replace it can delete it once the new cut is filed.
  ///
  /// Asked at the shape the row was cut at, which the row records: a nudge about
  /// a scope crop is about where the edges of scope sit, not about giving the
  /// format up, and an adjustment that quietly dropped it would answer "a little
  /// wider" with a cut that is no longer the shape everything else on the board
  /// was cut to. A row filed at no shape stays unconstrained, since holding a
  /// nudge to a ratio nobody ever stated would answer "more headroom" by taking
  /// width off the sides.
  const adjust = useCallback(
    async (version: CropOrigin, prompt: string) => {
      /// Whichever vocabulary the row recorded. A cut filed as "square" is nudged
      /// as a square, not as the exact ratio it happened to land at — which would
      /// pin the next box to the last box's rounding and call it the shape the
      /// user asked for.
      const asked = shapeAsked(version.editAspect);
      await ask(prompt, {
        previous: { cropBox: version.cropBox, editIntent: version.editIntent },
        origin: version,
        aspect: asked?.shape?.label ?? null,
        loose: asked?.loose?.id ?? null,
      });
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

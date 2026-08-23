import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { ToolReference } from "@/lib/agent/shared/reference";
import { CROP_CALL_LIMIT, cropCeilingSaid } from "@/lib/agent/orchestrator/reference-tools";
import { spentColumns, spentThrown } from "@/lib/agent/shared/model-cost";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import { cropNudge, cropOffer, unfittableAspect, type CropOffer } from "@/lib/crop/crop-offer";
import { hashBytes } from "@/lib/intake/content-hash";
import type { UploadContentType } from "@/lib/intake/image-types";
import {
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
  cropBoxOf,
  cropShapeOf,
  looseShapeOf,
  type CropShape,
  type LooseShape,
} from "@/lib/references/reference-version";
import { cropReference } from "@/server/agents/cropper";
import type { Cut } from "@/server/references/cut";
import { fileVersion } from "@/server/references/file-version";
import { isObjectTooLarge } from "@/server/google/storage";
import { TOOL_REFERENCE_SELECT, type ReferenceRow } from "@/server/references/tool-references";

/// Cutting a piece out of a picture and filing it as a version, as every agent
/// that has the door does it.
///
/// Lifted out of `referenceToolset`'s `makeCrop` whole, on `tool-generation.ts`'s
/// terms: agent 8 has the same tool under a different wire name
/// (compositor-v2.md §IV.4), and what the two must not disagree about is the
/// sequence — read the frame, spend a vision call, cut the pixels, store them,
/// file the row — because every step of it can fail after money has been spent
/// and each failure is a different sentence about what does and does not exist
/// now. Two copies of that is two places for "cut but not filed" to stop being
/// a failure.
///
/// It comes out in two pieces rather than one because the middle of that
/// sequence is the one part the two agents genuinely do differently. Agent 6
/// holds a cut to a *template slot*, read out of the board's layout; agent 8 has
/// no templates and holds it to a box it drew itself, read off `read_canvas`'s
/// own answer (`objectShape`). So `cutTarget` ends where that decision starts,
/// the caller makes it, and `makeCut` takes the shape it arrived at.
///
/// The wording is not here, for `drawPicture`'s reason: agent 6 writes a reply
/// beside a tile the user can see and names `crop_reference`, agent 8 writes a
/// closing line for agent 6 to say again and names `crop_image`.

/// The turn's cuts, counted by whoever owns the turn — `GenerationTally`'s twin
/// and passed in for the same reason: the ceiling is per turn and this is per
/// call.
export type CropTally = {
  /// Counted before the vision call, so a cut the cropper refused still spends
  /// its place. Reading the photograph is what costs, and it was read.
  asked: number;
  /// How many of those reached the catalog. The ceiling is on the calls and the
  /// sentence refusing the next one is about the project, and the two numbers
  /// come apart on exactly the turn where the wording matters most.
  filed: number;
};

export type CutNudge = NonNullable<ReturnType<typeof cropNudge>>;

/// What the ask resolved to, before any shape the board might refine it with.
export type CutTarget = {
  /// The row the model named. The cut itself when it named a cut, and then the
  /// one thing below that is not the frame.
  named: ReferenceRow;
  /// The picture the pixels come out of, which is an original either way: a
  /// nudge is asked of the frame with the old box attached rather than cut out
  /// of the cut.
  frame: ReferenceRow;
  nudge: CutNudge | null;
  intention: string;
  /// The exact shape asked for, when one was asked for and could be read.
  shape: CropShape | null;
  /// The loose shape asked for, when a word was said instead of a ratio. Never
  /// both — the two vocabularies do not overlap.
  loose: LooseShape | null;
  /// `shape`'s label, which is the spelling every step below carries it in.
  aspect: string | null;
};

export type CutTargeting = { error: string } | CutTarget;

export function targetFailed(targeting: CutTargeting): targeting is { error: string } {
  return "error" in targeting;
}

/// Which picture is being cut, at what shape, and whether the ask can be
/// answered at all — every refusal that costs a sentence rather than a
/// photograph.
export function cutTarget({
  frames,
  referenceId,
  intention,
  shapeSaid,
  /// The one word the two dialects disagree on: agent 6's gallery is
  /// "references" and agent 8's is "pictures", and a refusal naming the other
  /// agent's noun is the model being answered in a vocabulary its declarations
  /// never taught it.
  noun,
}: {
  frames: ReadonlyMap<string, ReferenceRow>;
  referenceId: string;
  intention: string;
  shapeSaid: string;
  noun: string;
}): CutTargeting {
  const named = frames.get(referenceId);
  if (!named) return { error: `no ${noun} called ${referenceId} in this project` };

  /// Named a cut rather than a photograph. That is not a crop of a crop: the box
  /// the user wants changed is already on the frame, so this is asked of the
  /// frame with that box attached — the panel's `adjust`, reached from the chat.
  /// See `cropNudge` for why the nested cut is the wrong answer.
  const nudge = named.source ? cropNudge(named) : null;
  const frame = named.source ? frames.get(named.source.id) : named;
  if (!frame) {
    return { error: `${referenceId} is a cut of a ${noun} this project no longer holds` };
  }
  if (named.source && !nudge) {
    return {
      error: `${referenceId} is a cut whose region was never recorded, so there is no box to move — crop ${frame.id}, the frame it came out of`,
    };
  }

  if (!intention) return { error: `say what to crop out of this ${noun}` };

  /// Any ratio the user said, not one of six names. A format the list does not
  /// name is a format all the same — 5:4 for a print, 2.35:1 for that scope —
  /// and the whole path below already carries a measured label, since a cut
  /// asked for an opening is held to that opening's own shape.
  ///
  /// A shape that cannot be read is refused rather than dropped: the model
  /// passed it because it was asked for, so cutting around the subject instead
  /// would be a cut of the wrong shape under an answer that says it is the right
  /// one. Refused here, before the row and before the photograph is read, so the
  /// correction costs a sentence.
  ///
  /// And the shapes with no number in them: "make it a rectangle" has named a
  /// shape and not a format, so answering with the nearest format is a
  /// substitution nobody asked for. Read first because the two vocabularies do
  /// not overlap — "square" is a word and "1:1" is a ratio — so one argument
  /// carries both. A nudge inherits the shape the row was cut at when none is
  /// named, the same rule the panel's own adjustment follows: "a little wider"
  /// about a scope crop is about where the edges of scope sit, and answering it
  /// unconstrained gives back a cut that is no longer the shape everything else
  /// was cut to. A shape that *was* named wins, since naming one is asking for a
  /// different cut.
  const asked = shapeSaid || (nudge?.asked ?? "");
  const loose = looseShapeOf(asked);
  const shape = loose ? null : cropShapeOf(asked);
  if (asked && !loose && !shape) {
    return {
      error: `“${asked}” is not a shape a cut can be held to — say it as width:height (${CROP_ASPECT_IDS.join(", ")}, or any ratio the user named such as 5:4), or loosely as ${LOOSE_SHAPE_IDS.join("/")}, or leave it out to frame around the subject`,
    };
  }

  const aspect = shape?.label ?? null;
  /// Read before the call rather than after it: a frame with no recorded size
  /// cannot be held to a format, and asking the model first would spend a vision
  /// call to arrive at the same sentence.
  const unfittable = unfittableAspect(frame, aspect);
  if (unfittable) return { error: unfittable };

  return { named, frame, nudge, intention, shape, loose, aspect };
}

export type CutMade = {
  row: ReferenceRow;
  /// The row as the caller's tools read pictures, already folded into whatever
  /// read it memoised so the next round can place it.
  filed: ToolReference;
  /// What the cropper decided, which is what every sentence about the cut is
  /// written off: the region, the intent, the reason and the shape it landed at.
  cut: CropOffer;
};

export type CutMaking = { error: string } | CutMade;

export function cutFailed(making: CutMaking): making is { error: string } {
  return "error" in making;
}

export async function makeCut({
  db,
  projectId,
  target: { named, frame, nudge, intention },
  /// The exact shape the cut is held to, which is the caller's own answer: the
  /// shape that was asked for, or the opening's ratio when the opening refined
  /// it. Null for a cut framed around its subject.
  held,
  /// The loose shape it is framed to instead, when it is not held to a ratio.
  /// Never both — an opening's ratio is exact, so a refined loose ask stops
  /// being loose.
  framed,
  tally,
  /// Which agent's door this came through, for the ledger alone: two agents file
  /// `CROPPER` runs against one project and the panel showing them has no other
  /// way to tell a design's cut from an orchestrator's.
  via,
  /// Agent 3, injected — the one thing here that reads a *photograph*, so it is
  /// the one whose cost a test must never pay.
  crop = cropReference,
  /// The pixels, cut on the server. Injected rather than imported because
  /// reaching it means loading `sharp`, and a test of the filing path never
  /// wants a codec in its module graph — so the default imports it only when a
  /// cut is really made.
  cutRegion = async (gcsUri: string, region: CropRegion) => {
    const { cutFromOriginal } = await import("@/server/references/cut");
    return cutFromOriginal(gcsUri, region);
  },
  storeImage,
  file,
  kickAnalyzer,
}: {
  db: PrismaClient;
  projectId: string;
  target: CutTarget;
  held: string | null;
  framed: LooseShape | null;
  tally: CropTally;
  via: string;
  crop?: typeof cropReference;
  cutRegion?: (gcsUri: string, region: CropRegion) => Promise<Cut>;
  storeImage: (contentType: UploadContentType, bytes: Uint8Array) => Promise<string>;
  file: (row: ReferenceRow) => ToolReference;
  kickAnalyzer: () => void;
}): Promise<CutMaking> {
  if (tally.asked >= CROP_CALL_LIMIT) {
    return { error: cropCeilingSaid(tally.asked, tally.filed) };
  }
  tally.asked += 1;

  /// The same row the panel's ask writes, for the same reason: what the cropper
  /// could not answer is readable afterwards instead of being a sentence that
  /// scrolled out of a chat.
  const run = await db.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.CROPPER,
      status: RunStatus.RUNNING,
      input: {
        /// The frame that is read, which is the frame the cut will be a version
        /// of — the same key the panel's own ask writes. The cut being moved is
        /// beside it rather than in its place, so a chain of nudges over one
        /// frame reads as a chain rather than as unrelated asks.
        referenceId: frame.id,
        prompt: intention,
        ...((held ?? framed?.id) && { aspect: held ?? framed?.id }),
        ...(nudge && { previous: nudge.previous, nudgeOf: named.id }),
        via,
      },
    },
    select: { id: true },
  });

  const fail = async (message: string, spent?: ReturnType<typeof spentColumns>) => {
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
    });
    return { error: message };
  };

  let answer;
  try {
    answer = await crop({
      gcsUri: frame.gcsUri,
      prompt: intention,
      title: frame.title,
      ...(held && { aspect: held }),
      ...(framed && { loose: framed, frame }),
      /// The box being moved. Without it the cropper reads the frame from
      /// nothing and answers with some other shot, which is the failure the
      /// panel's `previous` was added to prevent — and here it would arrive
      /// under an answer saying the cut had been adjusted.
      ...(nudge && { previous: nudge.previous }),
    });
  } catch (cause) {
    /// A refusal the cropper reached on its third read is the most expensive
    /// thing on this path, so the failed row carries the tokens too — a ledger
    /// that only counts the successes is a ledger that says a bad afternoon was
    /// cheap.
    return fail(
      cause instanceof Error ? cause.message : String(cause),
      spentThrown(cause) ?? undefined,
    );
  }

  const offered = cropOffer({
    reference: frame,
    box: answer.box,
    intent: answer.intent,
    rationale: answer.rationale,
    aspect: held,
    ...(framed && { loose: framed.id }),
  });
  const spent = spentColumns(answer.model, answer.usage);
  if ("refused" in offered) return fail(offered.refused, spent);

  /// What is left of the offer: the region to take out of the frame and the
  /// columns the row is filed under. `cropOffer` still decides whether there is a
  /// cut to make at all — "the whole frame is the shot" is refused above, and it
  /// is the cropper reading the photograph correctly rather than a failure.
  const cut = offered.offer;
  /// The box back in the shape a row is filed from. The plan carries the columns
  /// because that is what the browser used to be sent, and they came out of a box
  /// that was valid a line ago.
  const cropBox = cropBoxOf(cut.cropBox)!;

  let pixels: Cut;
  try {
    pixels = await cutRegion(frame.gcsUri, cut.region);
  } catch (cause) {
    /// The read of the photograph is already paid for by this point, so the row
    /// carries it — and the sentence says the cut does not exist, because a model
    /// told only "something went wrong" describes one anyway.
    console.error("a cut could not be made:", cause);
    return fail(
      /// A photograph too large to read back is told apart from every other way
      /// the codec fails, because it is the only one that will be just as true on
      /// the second call: the other crops the ceiling allows would be spent
      /// finding that out again.
      isObjectTooLarge(cause)
        ? `the box was found but ${frame.id} is too large a file to cut here, so nothing was filed — say the photograph is too big to crop rather than describing a cut, and do not ask for a cut of it again`
        : "the box was found but the picture could not be cut, so nothing was filed — say so rather than describing a cut",
      spent,
    );
  }

  let gcsUri;
  let thumbGcsUri: string | undefined;
  try {
    gcsUri = await storeImage(pixels.contentType, pixels.bytes);
    /// Made in the same pass as the cut, so a crop filed this way lands complete
    /// — unlike a drawn picture, which leaves its row owing a grid-sized copy to
    /// the workspace's sweep.
    if (pixels.thumbnail) {
      thumbGcsUri = await storeImage(pixels.thumbnail.contentType, pixels.thumbnail.bytes);
    }
  } catch (cause) {
    console.error("a cut could not be stored:", cause);
    return fail(
      "the cut was made but could not be stored, so it is not in the project — say so rather than describing it",
      spent,
    );
  }

  /// The same digest the panel's cut stores, off bytes that were never wrapped in
  /// a `File`. It is not what stops a duplicate: both hash lookups are asked of
  /// originals only, on purpose (`existingHashes`), so nothing reads a version's.
  /// What it buys is that a cut's row records no less about its bytes for having
  /// been filed by an assistant — the same reason the row itself goes through
  /// `fileVersion`.
  const contentHash = await hashBytes(pixels.bytes);

  /// The row and its analyzer job, through the same function the properties panel
  /// files a cut with: what a cut of a frame is called and where it counts as
  /// having come from follow from the frame, and doors deriving them apart would
  /// fill the versions list with cuts that do not match.
  let row;
  try {
    row = await db.$transaction((tx) =>
      fileVersion(
        tx,
        {
          projectId,
          source: frame,
          gcsUri,
          thumbGcsUri,
          editIntent: cut.editIntent,
          editRationale: cut.editRationale,
          cropBox,
          editAspect: cut.aspect ?? cut.loose,
          width: pixels.width,
          height: pixels.height,
          contentHash,
        },
        TOOL_REFERENCE_SELECT,
      ),
    );
  } catch (cause) {
    /// The most expensive thing on this path to lose: the photograph is read and
    /// paid for, the bytes are in the bucket, and the row that would make them a
    /// reference is not there.
    console.error("a cut could not be filed:", cause);
    return fail(
      "the cut was made and stored but the row that makes it a reference could not be written, so there is nothing to show or place — say so rather than describing it",
      spent,
    );
  }

  kickAnalyzer();
  const filed = file(row);
  tally.filed += 1;

  await db.agentRun.update({
    where: { id: run.id },
    data: {
      status: RunStatus.SUCCEEDED,
      /// The filed row beside the box it was cut to, which is what the ledger
      /// could never say while this tool ended at an offer: a run whose cut
      /// nobody took and a run whose cut is on a board read identically.
      output: {
        ...cut,
        referenceId: row.id,
        cutOf: frame.id,
        ...(nudge && { nudgeOf: named.id }),
        model: answer.model,
        attempts: answer.attempts,
      },
      finishedAt: new Date(),
      ...spent,
    },
  });

  return { row, filed, cut };
}

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
import { cropReference } from "@/server/agents/cropper/cropper";
import type { Cut } from "@/server/references/cut";
import { fileVersion } from "@/server/references/file-version";
import { isObjectTooLarge } from "@/server/google/storage";
import { TOOL_REFERENCE_SELECT, type ReferenceRow } from "@/server/references/tool-references";

export type CropTally = {
  asked: number;
  filed: number;
};

export type CutNudge = NonNullable<ReturnType<typeof cropNudge>>;

export type CutTarget = {
  named: ReferenceRow;
  frame: ReferenceRow;
  nudge: CutNudge | null;
  intention: string;
  shape: CropShape | null;
  loose: LooseShape | null;
  aspect: string | null;
};

export type CutTargeting = { error: string } | CutTarget;

export function targetFailed(targeting: CutTargeting): targeting is { error: string } {
  return "error" in targeting;
}

export function cutTarget({
  frames,
  referenceId,
  intention,
  shapeSaid,
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

  const asked = shapeSaid || (nudge?.asked ?? "");
  const loose = looseShapeOf(asked);
  const shape = loose ? null : cropShapeOf(asked);
  if (asked && !loose && !shape) {
    return {
      error: `“${asked}” is not a shape a cut can be held to — say it as width:height (${CROP_ASPECT_IDS.join(", ")}, or any ratio the user named such as 5:4), or loosely as ${LOOSE_SHAPE_IDS.join("/")}, or leave it out to frame around the subject`,
    };
  }

  const aspect = shape?.label ?? null;
  const unfittable = unfittableAspect(frame, aspect);
  if (unfittable) return { error: unfittable };

  return { named, frame, nudge, intention, shape, loose, aspect };
}

export type CutMade = {
  row: ReferenceRow;
  filed: ToolReference;
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
  held,
  framed,
  tally,
  via,
  crop = cropReference,
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

  const run = await db.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.CROPPER,
      status: RunStatus.RUNNING,
      input: {
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
      ...(nudge && { previous: nudge.previous }),
    });
  } catch (cause) {
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

  const cut = offered.offer;
  const cropBox = cropBoxOf(cut.cropBox)!;

  let pixels: Cut;
  try {
    pixels = await cutRegion(frame.gcsUri, cut.region);
  } catch (cause) {
    console.error("a cut could not be made:", cause);
    return fail(
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

  const contentHash = await hashBytes(pixels.bytes);

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

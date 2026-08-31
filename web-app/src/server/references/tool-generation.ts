import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AgentKind, ReferenceOrigin, RunStatus } from "@/generated/prisma/enums";
import type { ToolReference } from "@/lib/agent/shared/reference";
import { GENERATE_CALL_LIMIT, generationCeilingSaid } from "@/lib/agent/orchestrator/reference-tools";
import { spentColumns, spentThrown } from "@/lib/agent/shared/model-cost";
import { isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";
import { generatedImageTitle, pngPixelSize } from "@/lib/references/generated-image";
import {
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
  shapeAsked,
  type ShapeAsked,
} from "@/lib/references/reference-version";
import { enqueueAnalysis } from "@/server/agents/analyzer/analysis-enqueue";
import { generateImage } from "@/server/agents/image-generator/image-generator";
import { TOOL_REFERENCE_SELECT, type ReferenceRow } from "@/server/references/tool-references";
import { galleryFullForProject } from "@/server/limits/quota";

export type GenerationTally = {
  asked: number;
  filed: number;
};

export type PictureDrawn = {
  row: ReferenceRow;
  picture: ToolReference;
  title: string;
  size: { width: number; height: number } | null;
  shape: ShapeAsked | null;
  offShape: boolean;
};

export type PictureDrawing = { error: string } | PictureDrawn;

export function drawnFailed(drawing: PictureDrawing): drawing is { error: string } {
  return "error" in drawing;
}

export async function drawPicture({
  db,
  projectId,
  description,
  shapeSaid,
  via,
  tally,
  takenTitles,
  file,
  generate = generateImage,
  storeImage,
  kickAnalyzer,
  kickThumbnail,
}: {
  db: PrismaClient;
  projectId: string;
  description: string;
  shapeSaid: string;
  via: string;
  tally: GenerationTally;
  takenTitles: () => Promise<string[]>;
  file: (row: ReferenceRow) => ToolReference;
  generate?: typeof generateImage;
  storeImage: (contentType: UploadContentType, bytes: Uint8Array) => Promise<string>;
  kickAnalyzer: () => void;
  kickThumbnail: (referenceId: string, bytes: Uint8Array) => void;
}): Promise<PictureDrawing> {
  if (!description) return { error: "say what the picture should show" };

  const shape = shapeSaid ? shapeAsked(shapeSaid) : null;
  if (shapeSaid && !shape) {
    return {
      error: `“${shapeSaid}” is not a shape a picture can be drawn at — say it as width:height (${CROP_ASPECT_IDS.join(", ")}, or any ratio the user named such as 5:4), or loosely as ${LOOSE_SHAPE_IDS.join("/")}, or leave it out and the drawing model picks one`,
    };
  }

  if (tally.asked >= GENERATE_CALL_LIMIT) {
    return { error: generationCeilingSaid(tally.asked, tally.filed) };
  }

  const full = await galleryFullForProject(db, { projectId });
  if (full) return { error: full };

  tally.asked += 1;

  const run = await db.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.IMAGE_GENERATOR,
      status: RunStatus.RUNNING,
      input: {
        prompt: description,
        ...(shape && { aspect: shape.label }),
        via,
      },
    },
    select: { id: true },
  });

  const fail = async (
    message: string,
    spent?: ReturnType<typeof spentColumns>,
    recorded?: string,
  ) => {
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.FAILED,
        error: recorded ?? message,
        finishedAt: new Date(),
        ...spent,
      },
    });
    return { error: message };
  };

  let drawn;
  try {
    drawn = await generate({ description, shape });
  } catch (cause) {
    const detail = (cause as { detail?: unknown } | null | undefined)?.detail;
    return fail(
      cause instanceof Error ? cause.message : String(cause),
      spentThrown(cause) ?? undefined,
      typeof detail === "string" ? detail : undefined,
    );
  }

  const spent = spentColumns(drawn.model, drawn.usage);
  const contentType = isUploadContentType(drawn.mimeType) ? drawn.mimeType : "image/png";

  let gcsUri;
  try {
    gcsUri = await storeImage(contentType, drawn.bytes);
  } catch (cause) {
    console.error("a generated picture could not be stored:", cause);
    return fail(
      "the picture was drawn but could not be stored, so it is not in the project — say so rather than describing it",
      spent,
    );
  }

  const size = pngPixelSize(drawn.bytes);
  const title = generatedImageTitle(description, await takenTitles());

  let row;
  try {
    row = await db.$transaction(async (tx) => {
      const created = await tx.reference.create({
        data: {
          projectId,
          gcsUri,
          title,
          origin: ReferenceOrigin.GENERATED,
          generationPrompt: description,
          ...(size && { width: size.width, height: size.height }),
        },
        select: TOOL_REFERENCE_SELECT,
      });
      await enqueueAnalysis(tx, { projectId, referenceId: created.id });
      return created;
    });
  } catch (cause) {
    console.error("a generated picture could not be filed:", cause);
    return fail(
      "the picture was drawn but could not be filed in the project, so there is nothing to place or show — say so rather than describing it",
      spent,
    );
  }

  kickAnalyzer();
  kickThumbnail(row.id, drawn.bytes);
  const picture = file(row);
  tally.filed += 1;

  await db.agentRun.update({
    where: { id: run.id },
    data: {
      status: RunStatus.SUCCEEDED,
      output: {
        referenceId: row.id,
        title,
        ...(size && size),
        model: drawn.model,
        attempts: drawn.attempts,
      },
      finishedAt: new Date(),
      ...spent,
    },
  });

  const drawnRatio = size ? size.width / size.height : null;
  return {
    row,
    picture,
    title,
    size,
    shape,
    offShape: Boolean(
      shape?.shape && drawnRatio && Math.abs(Math.log(drawnRatio / shape.shape.ratio)) > 0.02,
    ),
  };
}

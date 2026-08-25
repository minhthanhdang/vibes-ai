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

/// Drawing a picture and filing it, as every agent that has the door does it.
///
/// Lifted out of `referenceToolset`'s `makePicture` whole, on the terms
/// `tool-references.ts` was lifted out on: agent 8 has the same tool under the
/// same wire name (compositor-v2.md §IV.4), and the contract it has to keep —
/// bytes in the bucket and a `Reference` row filed before the answer says the
/// picture exists — is a property of this sequence rather than of either agent.
/// Two copies of it would be two places for "drawn but not stored" to stop being
/// a failure.
///
/// What is *not* here is the wording. The two agents answer different readers —
/// agent 6 writes a reply beside a tile the user can see, agent 8 writes a
/// closing line for agent 6 to say again in fewer words — and they name their
/// own crop tool. So this ends at the facts (the row, the title, the size, and
/// whether the drawing came back at the shape that was asked for) and each tool
/// layer says them in its own dialect.

/// The turn's generations, counted by whoever owns the turn.
///
/// Passed in rather than held here because the ceiling is per turn and this is
/// per call: a module-level counter would be a ceiling shared between two
/// projects being designed at once. Mutated rather than returned, so the count
/// survives a call that threw its way out of the sequence below.
export type GenerationTally = {
  /// Counted before the model call, so a refusal still spends its place — the
  /// second attempt at a description the image model would not draw is the same
  /// money as the first.
  asked: number;
  /// How many of those reached the catalog. The ceiling is on the calls, but the
  /// sentence refusing the next one is about the project, and the two numbers
  /// come apart on exactly the turn where the wording matters most.
  filed: number;
};

export type PictureDrawn = {
  row: ReferenceRow;
  /// The row as the tools read pictures, already folded into the caller's own
  /// read of the project so the next round can place it.
  picture: ToolReference;
  title: string;
  /// Read off the PNG header, and null when the header would not give it up.
  size: { width: number; height: number } | null;
  /// The shape the model asked for, when it named one that can be read.
  shape: ShapeAsked | null;
  /// The drawing came back at a ratio that is not the one asked for. An exact
  /// ratio is a request in a prompt rather than a setting on an API, so what
  /// came back is measured — without this the model reports the shape it asked
  /// for as the shape it got, and the backdrop is stretched onto the page by
  /// whoever places it.
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
  /// Which agent's door this came through, for the ledger alone: two agents file
  /// `IMAGE_GENERATOR` runs against one project and the panel showing them has no
  /// other way to tell a design's drawing from an orchestrator's.
  via,
  tally,
  /// The titles this picture is named clear of — the turn's own list, so a
  /// picture drawn earlier in the same turn is one of the names avoided. Asked
  /// for as late as it can be, which is after the drawing.
  takenTitles,
  /// The caller folding the new row into whatever read it memoised, and handing
  /// back the row in the shape its tools answer with. Nothing here knows how the
  /// caller holds its pictures; what both callers must do is have this id resolve
  /// on the next round, which is the round the declaration promises it can be
  /// placed on.
  file,
  generate = generateImage,
  storeImage,
  kickAnalyzer,
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
}): Promise<PictureDrawing> {
  if (!description) return { error: "say what the picture should show" };

  /// `crop_reference`'s dialect, read here rather than in the generator for the
  /// reason the crop reads it here: a shape that cannot be read is refused with
  /// a sentence before anything is spent, and drawing the picture at some other
  /// shape instead would be a background of the wrong shape under a reply
  /// saying it is the right one.
  const shape = shapeSaid ? shapeAsked(shapeSaid) : null;
  if (shapeSaid && !shape) {
    return {
      error: `“${shapeSaid}” is not a shape a picture can be drawn at — say it as width:height (${CROP_ASPECT_IDS.join(", ")}, or any ratio the user named such as 5:4), or loosely as ${LOOSE_SHAPE_IDS.join("/")}, or leave it out and the drawing model picks one`,
    };
  }

  if (tally.asked >= GENERATE_CALL_LIMIT) {
    return { error: generationCeilingSaid(tally.asked, tally.filed) };
  }
  tally.asked += 1;

  /// The same row every other model call writes, and written before the call:
  /// what the image model would not draw is readable in the panel afterwards
  /// instead of being a sentence that scrolled out of a chat.
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

  /// `recorded` is what the row keeps when the sentence handed back is one the
  /// generator wrote rather than the model's own words: the sentence is a
  /// constant of the code and the underlying `vertex 429: {…}` is the only
  /// part of the failure that is not recoverable from reading it.
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
    /// A refusal is charged for the tokens it took to reach — the image model
    /// bills the thinking it did before deciding not to draw — so the failed
    /// row carries them, exactly as a refused crop does. Either way the
    /// message is a sentence: the generator writes one when the call never
    /// landed, so a throttled burst reaches the model as words rather than as
    /// the HTML page Vertex answers a busy image model with.
    /// Read off the thrown value the way its tokens are, and for the same
    /// reason: the generator sets it, nothing else does, and a class is a
    /// module identity where a field is a fact.
    const detail = (cause as { detail?: unknown } | null | undefined)?.detail;
    return fail(
      cause instanceof Error ? cause.message : String(cause),
      spentThrown(cause) ?? undefined,
      typeof detail === "string" ? detail : undefined,
    );
  }

  const spent = spentColumns(drawn.model, drawn.usage);
  /// PNG is what this model answers with (infra.md §X) and what the bucket is
  /// told; anything else it ever answers with is stored as what it says it is,
  /// since the object's name is the only record of its type.
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

  /// Read off the file's own header rather than from an image library or a
  /// canvas the server does not have. A reference with no size is a reference
  /// no layout can place, and this is twenty-four bytes.
  const size = pngPixelSize(drawn.bytes);
  /// Named against what the project already calls its pictures.
  const title = generatedImageTitle(description, await takenTitles());

  /// The row and its analyzer job land together, exactly as in `add` and in
  /// `importFromUrl`: a reference with no job is one the panel offers to
  /// analyze by hand, which is not what a picture filed by a tool should be.
  let row;
  try {
    row = await db.$transaction(async (tx) => {
      const created = await tx.reference.create({
        data: {
          projectId,
          gcsUri,
          title,
          origin: ReferenceOrigin.GENERATED,
          /// What it was drawn from, kept because it is the only record of
          /// what this picture *is* until the analyzer reads it — and the only
          /// way a user looking at the tile a week later can see it was
          /// written rather than shot.
          generationPrompt: description,
          ...(size && { width: size.width, height: size.height }),
        },
        select: TOOL_REFERENCE_SELECT,
      });
      await enqueueAnalysis(tx, { projectId, referenceId: created.id });
      return created;
    });
  } catch (cause) {
    /// The one path left that could reach the model as a raw exception, and
    /// the most expensive one to lose: the picture is drawn and paid for, the
    /// bytes are in the bucket, and the row that would make them a reference
    /// is not there. Answered as a sentence like every other refusal, so the
    /// run row carries what it cost instead of standing at RUNNING forever.
    console.error("a generated picture could not be filed:", cause);
    return fail(
      "the picture was drawn but could not be filed in the project, so there is nothing to place or show — say so rather than describing it",
      spent,
    );
  }

  kickAnalyzer();
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

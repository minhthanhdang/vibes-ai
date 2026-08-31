import "server-only";
import { MODELS, generateContent, type Content } from "@/server/google/vertex";
import type { CropOp, EditOp, EditOpKind } from "@/lib/edit/edit-ops";
import {
  CROP_BOX_SCALE,
  cropBoxOf,
  editIntent,
  priorCropNote,
  refinedIntent,
  type CropBox,
  type LooseShape,
} from "@/lib/references/reference-version";
import { contentTypeOfUri } from "@/lib/intake/image-types";
import { NO_USAGE, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { withAgent } from "@/server/agents/shared/agent-scope";
import { instructionFor } from "@/server/agents/image-editor/instruction";
import { runImageEditor } from "@/server/agents/image-editor/loop";
import { editorToolset } from "@/server/agents/image-editor/toolset";
import type { EditPreviewing } from "@/server/references/edits";

const WHOLE_FRAME: CropBox = {
  ymin: 0,
  xmin: 0,
  ymax: CROP_BOX_SCALE,
  xmax: CROP_BOX_SCALE,
};

export type ImageEditorResult = {
  model: string;
  box: CropBox;
  ops: EditOp[];
  intent: string;
  rationale: string;
  attempts: number;
  looks: number;
  usage: TokenUsage;
};

export class ImageEditorError extends Error {
  usage: TokenUsage = NO_USAGE;

  model = MODELS.FLASH;
}

export type PriorCrop = { cropBox: number[]; editIntent?: string };

export function editReference(asked: Parameters<typeof editingReference>[0]) {
  return withAgent("image-editor", () => editingReference(asked));
}

async function editingReference({
  gcsUri,
  prompt,
  title,
  previous,
  aspect,
  loose,
  frame,
  only,
  preview,
  generate = generateContent,
}: {
  gcsUri: string;
  prompt: string;
  title?: string;
  previous?: PriorCrop;
  aspect?: string;
  loose?: LooseShape;
  frame?: { width?: unknown; height?: unknown };
  only?: EditOpKind;
  preview?: EditPreviewing;
  generate?: typeof generateContent;
}): Promise<ImageEditorResult> {
  const mimeType = contentTypeOfUri(gcsUri);
  if (!mimeType) throw new Error(`cannot edit ${gcsUri}: unrecognized image type`);

  const asked = editIntent(prompt);
  if (!asked) throw new ImageEditorError("say what to do with this reference");

  const prior = previous ? priorCropNote(previous) : null;
  const asking = prior
    ? `${prior} The user wants that box changed: ${asked}`
    : `The user wants: ${asked}`;
  const request = loose
    ? `${asking} The crop should be framed ${loose.wants}, and the box you call with is the shape of the cut — nothing is opened out afterwards.`
    : aspect
      ? `${asking} The crop will be held to ${aspect}.`
      : asking;

  const held = loose && frame ? { loose, frame } : undefined;
  const toolset = editorToolset({ only, held, preview });

  const ask: Content = {
    role: "user",
    parts: [
      { fileData: { fileUri: gcsUri, mimeType } },
      { text: title ? `The user filed this reference as "${title}". ${request}` : request },
    ],
  };

  const run = await runImageEditor({
    ask,
    instruction: instructionFor(only),
    toolset,
    generate,
  });

  if (!run.ops.length) {
    throw Object.assign(new ImageEditorError(refusalSaid(run.stopped, run.fault)), {
      usage: run.usage,
    });
  }

  return {
    model: MODELS.FLASH,
    box: boxOf(run.ops),
    ops: run.ops,
    intent: refinedIntent({
      answered: run.intent,
      previous: previous?.editIntent,
      asked,
    }),
    rationale: run.rationale,
    attempts: run.rounds,
    looks: run.pictures,
    usage: run.usage,
  };
}

function refusalSaid(stopped: string | undefined, fault: string | undefined): string {
  if (stopped === "repeat" && fault) {
    return `the image editor asked for the same unusable edit twice: ${fault}`;
  }
  if (fault) return `the image editor could not answer with a usable edit: ${fault}`;
  return "the image editor made no edit to this reference";
}

function boxOf(ops: readonly EditOp[]): CropBox {
  const crop = ops.find((op): op is CropOp => op.op === "crop");
  return (crop && cropBoxOf(crop.box)) || WHOLE_FRAME;
}

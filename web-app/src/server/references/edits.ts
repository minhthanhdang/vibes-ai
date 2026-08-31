import "server-only";
import sharp, { type Sharp } from "sharp";
import { croppedPixels } from "@/lib/canvas/moodboard-crop";
import { gradeLinear, gradeModulate } from "@/lib/edit/edit-grade";
import { QUARTER_TURNS, type CropOp, type EditOp } from "@/lib/edit/edit-ops";
import { boxRegion, cropBoxOf } from "@/lib/references/reference-version";
import { readObject } from "@/server/google/storage";

export function applyEdits(image: Sharp, ops: readonly EditOp[]): Sharp {
  let edited = image;
  for (const op of ops) {
    switch (op.op) {
      case "crop":
        break;
      case "turn":
        edited = edited.rotate(QUARTER_TURNS[op.turn]);
        break;
      case "flip":
        if (op.axis !== "vertical") edited = edited.flop();
        if (op.axis !== "horizontal") edited = edited.flip();
        break;
      case "grade": {
        const linear = gradeLinear(op);
        if (linear) edited = edited.linear(linear.a, linear.b);
        const modulate = gradeModulate(op);
        if (modulate) edited = edited.modulate(modulate);
        break;
      }
    }
  }
  return edited;
}

export const EDIT_PREVIEW_MAX_EDGE = 768;

export const EDIT_PREVIEW_QUALITY = 80;

export const EDIT_PREVIEW_TYPE = "image/jpeg";

export type EditPreview = { base64: string; mimeType: string };

export type EditPreviewing = (ops: readonly EditOp[]) => Promise<EditPreview | null>;

export async function previewOf(
  source: Uint8Array,
  ops: readonly EditOp[],
): Promise<EditPreview | null> {
  const image = sharp(source, { autoOrient: true });
  const frame = (await image.metadata()).autoOrient;
  if (!frame?.width || !frame.height) return null;

  const crop = ops.find((op): op is CropOp => op.op === "crop");
  const box = crop ? cropBoxOf(crop.box) : null;
  const cut = box ? croppedPixels(boxRegion(box), frame) : null;
  const framed = cut
    ? image.extract({ left: cut.x, top: cut.y, width: cut.width, height: cut.height })
    : image;

  const bytes = await applyEdits(framed, ops)
    .resize({
      width: EDIT_PREVIEW_MAX_EDGE,
      height: EDIT_PREVIEW_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: EDIT_PREVIEW_QUALITY })
    .toBuffer();
  return { base64: Buffer.from(bytes).toString("base64"), mimeType: EDIT_PREVIEW_TYPE };
}

export function previewFromOriginal(gcsUri: string, limit: number): EditPreviewing {
  let source: Promise<Uint8Array> | null = null;

  return async (ops) => {
    try {
      source ??= readObject(gcsUri, limit);
      return await previewOf(await source, ops);
    } catch (cause) {
      console.error("an edit could not be previewed:", cause);
      return null;
    }
  };
}

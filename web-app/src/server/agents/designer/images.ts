import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { canvasObjects } from "@/lib/canvas-objects/object-read";
import { objectShape } from "@/lib/canvas-objects/object-shape";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import type { EditOp } from "@/lib/edit/edit-ops";
import { editSaid } from "@/lib/edit/edit-said";
import type { EditPreviewing } from "@/server/references/edits";
import { cropOfferCaption, cropOfferShape } from "@/lib/crop/crop-offer";
import { EDIT_IMAGE, DESIGNER_GENERATE_IMAGE } from "@/lib/agent/designer/image-tools";
import type { UploadContentType } from "@/lib/intake/image-types";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import { editReference } from "@/server/agents/image-editor/image-editor";
import { generateImage } from "@/server/agents/image-generator/image-generator";
import type { Cut } from "@/server/references/cut";
import {
  cutFailed,
  cutTarget,
  makeCut,
  targetFailed,
  type CropTally,
} from "@/server/references/tool-crop";
import {
  drawPicture,
  drawnFailed,
  type GenerationTally,
} from "@/server/references/tool-generation";
import { storeProjectUpload } from "@/server/references/upload";

export const GENERATED_STATUS =
  "drawn and filed in the gallery — an image like any other now, and put_on_canvas takes this id on the next round. The analyzer reads it minutes behind; until it does, its line in list_gallery carries the description above and nothing read off the pixels. Say in your closing line that the picture was made rather than found.";

export const GENERATED_UNSIZED_STATUS =
  "drawn and filed in the gallery, but its pixel size could not be read — so its shape is not known here and a box for it cannot be checked against it. It is an image like any other and put_on_canvas takes this id on the next round. Say in your closing line that the picture was made rather than found.";

export const CUT_STATUS =
  "cut and filed in the gallery as a modification of the picture it came out of — that picture is untouched and still there. Nothing on any board changed: put_on_canvas takes this id on the next round, and remove_from_canvas takes the old one off if it is standing where this one goes. discard_image is the way back if it is not the shot you meant.";

export type PictureBudget = { generations: GenerationTally; crops: CropTally };

export const ownPictureBudget = (): PictureBudget => ({
  generations: { asked: 0, filed: 0 },
  crops: { asked: 0, filed: 0 },
});

export type ImageToolset = {
  declarations: ToolDeclaration[];
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
  made: () => { generated: string[]; cropped: string[] };
};

export function imageToolset({
  db,
  projectId,
  boardId,
  references = designerReferences({ db, projectId }),
  budget = ownPictureBudget(),
  generate = generateImage,
  edit = editReference,
  cutRegion,
  previewEdit,
  storeImage = (contentType: UploadContentType, bytes: Uint8Array) =>
    storeProjectUpload(projectId, contentType, bytes),
  kickAnalyzer = () => {
    void import("@/server/agents/analyzer/analysis-queue").then(({ kickAnalyzerWorker }) =>
      kickAnalyzerWorker(),
    );
  },
  kickThumbnail = (referenceId: string, bytes: Uint8Array) => {
    void import("@/server/references/thumbnail-queue").then(({ kickReferenceThumbnail }) =>
      kickReferenceThumbnail({ projectId, referenceId, bytes }),
    );
  },
}: {
  db: PrismaClient;
  projectId: string;
  boardId: string;
  references?: DesignerReferences;
  budget?: PictureBudget;
  generate?: typeof generateImage;
  edit?: typeof editReference;
  cutRegion?: (gcsUri: string, region: CropRegion, ops?: readonly EditOp[]) => Promise<Cut>;
  previewEdit?: (gcsUri: string) => Promise<EditPreviewing | undefined>;
  storeImage?: (contentType: UploadContentType, bytes: Uint8Array) => Promise<string>;
  kickAnalyzer?: () => void;
  kickThumbnail?: (referenceId: string, bytes: Uint8Array) => void;
}): ImageToolset {
  const generated: string[] = [];
  const cropped: string[] = [];

  async function makeImage(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const drawing = await drawPicture({
      db,
      projectId,
      description: typeof args.description === "string" ? args.description.trim() : "",
      shapeSaid: typeof args.aspect === "string" ? args.aspect.trim() : "",
      via: "designer",
      tally: budget.generations,
      takenTitles: async () => (await references()).all.map((reference) => reference.title),
      file: references.file,
      generate,
      storeImage,
      kickAnalyzer,
      kickThumbnail,
    });
    if (drawnFailed(drawing)) return { result: { error: drawing.error } };
    const { row, title, size, shape, offShape } = drawing;
    generated.push(row.id);

    return {
      result: {
        imageId: row.id,
        title,
        ...(size ?? {}),
        ...(shape && { aspect: shape.label }),
        ...(offShape && {
          drawnAt: `${size!.width}×${size!.height}, which is not ${shape!.label} — draw the box to this shape rather than to the one you asked for, or cut it exact with edit_image first`,
        }),
        status: size ? GENERATED_STATUS : GENERATED_UNSIZED_STATUS,
      },
    };
  }

  async function opening(objectId: string) {
    const board = await db.moodboard.findFirst({
      where: { id: boardId, projectId },
      select: { elements: true },
    });
    if (!board) return { error: `no board called ${boardId} in this project` };

    const objects = canvasObjects(board.elements) ?? [];
    if (!objects.some((object) => object.objectId === objectId)) {
      return {
        error: `no object called ${objectId} on that board — objectIds come from read_canvas, and an imageId is not a handle: the same picture placed twice is two objects`,
      };
    }

    const shape = objectShape(objects, objectId);
    return (
      shape ?? {
        error: `${objectId} has no shape a cut can be held to — it is either a sliver or a box with no size. Crop without toObjectId and place the cut with put_on_canvas, or fix the box with transform_on_canvas first`,
      }
    );
  }

  async function cutImage(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const { rows } = await references();
    const imageId = typeof args.imageId === "string" ? args.imageId.trim() : "";
    const targeting = cutTarget({
      frames: rows,
      referenceId: imageId,
      intention: typeof args.intention === "string" ? args.intention.trim() : "",
      shapeSaid: typeof args.aspect === "string" ? args.aspect.trim() : "",
      noun: "picture",
    });
    if (targetFailed(targeting)) return { result: { error: targeting.error } };
    const { named, frame, nudge, loose, aspect } = targeting;

    const toObjectId = typeof args.toObjectId === "string" ? args.toObjectId.trim() : "";
    const box = toObjectId ? await opening(toObjectId) : null;
    if (box && "error" in box) return { result: { error: box.error } };

    const said = typeof args.aspect === "string" && Boolean(args.aspect.trim());
    const heldToBox = box && !said && frame.width && frame.height ? box : null;
    const held = heldToBox ? heldToBox.shape.label : aspect;
    const framed = heldToBox ? null : loose;

    const making = await makeCut({
      db,
      projectId,
      target: targeting,
      held,
      framed,
      tally: budget.crops,
      via: "designer",
      edit,
      ...(cutRegion && { cutRegion }),
      ...(previewEdit && { previewEdit }),
      storeImage,
      file: references.file,
      kickAnalyzer,
    });
    if (cutFailed(making)) return { result: { error: making.error } };
    const { row, cut, ops } = making;
    cropped.push(row.id);

    return {
      result: {
        imageId: row.id,
        cutOf: frame.id,
        ...(nudge && {
          nudgeOf: `${named.id} is untouched — this is that cut moved, filed as a second modification of ${frame.id}. It is still in the gallery, and discard_image is how it goes`,
        }),
        keeps: cut.editIntent,
        did: editSaid(ops),
        why: cut.editRationale,
        ...(cut.aspect && { aspect: cut.aspect }),
        ...(framed && {
          framedAs: `framed ${framed.wants} rather than held to an exact ratio — the cut came out ${cropOfferShape(cut, frame) ?? "a shape this picture's pixel size was never recorded to measure"}`,
        }),
        size: cropOfferCaption(cut, frame),
        status: CUT_STATUS,
        ...(heldToBox && {
          heldTo: `held to ${cut.aspect}, the exact shape of ${heldToBox.objectId}${heldToBox.name ? ` (${heldToBox.name})` : ""} — ${heldToBox.width}×${heldToBox.height} on the board${heldToBox.clipped ? ", measured over the part its page shows rather than the whole of it" : ""}. Give put_on_canvas that object's own box and the cut fills it with no page showing`,
        }),
      },
    };
  }

  return {
    declarations: [DESIGNER_GENERATE_IMAGE, EDIT_IMAGE],

    made: () => ({ generated: [...generated], cropped: [...cropped] }),

    async execute({ name, args }) {
      switch (name) {
        case DESIGNER_GENERATE_IMAGE.name:
          return makeImage(args);

        case EDIT_IMAGE.name:
          return cutImage(args);

        default:
          return null;
      }
    },
  };
}

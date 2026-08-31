import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import {
  usingPagesSaid,
  type UsingBoard,
  type UsingPage,
} from "@/lib/references/reference-usage";
import {
  cropBoxAtAspect,
  cropBoxColumns,
  cropBoxOf,
  cropCoverageLabel,
  cropShapeMeasured,
  cropShapeOf,
  cropSizeLabel,
  cropSoftOnBoard,
  looseShapeOf,
  shapeAsked,
  type CropBox,
} from "@/lib/references/reference-version";
import { cropPlan, editBox, editShape } from "@/lib/references/reference-edit";
import { quarterTurned, type EditOp } from "@/lib/edit/edit-ops";

export type CropOffer = {
  referenceId: string;
  region: CropRegion;
  cropBox: number[];
  editIntent: string;
  editRationale: string;
  aspect: string | null;
  loose?: string;
};

export function cropNudge(cut: { id: string; edit?: unknown; editIntent?: string | null }) {
  const box = cropBoxOf(editBox(cut.edit));
  if (!box) return null;

  const columns = cropBoxColumns(box);
  const editIntent = cut.editIntent?.trim() ?? "";
  const asked = shapeAsked(editShape(cut.edit));
  const shape = asked?.shape?.label ?? asked?.loose?.id ?? null;
  return {
    previous: { cropBox: columns, editIntent },
    asked: shape,
    origin: { id: cut.id, edit: cut.edit, editIntent },
  };
}

export const STANDING_ON_LIMIT = 2;

export type BoardStandingOn = { id: string; title: string; takeOff: string; pages?: UsingPage[] };

export function boardsStandingOn(
  usage: ReadonlyMap<string, readonly UsingBoard[]>,
  { cut, frame }: { cut?: string | null; frame: string },
): BoardStandingOn[] {
  const standing = new Map<string, BoardStandingOn>();
  for (const id of [cut, frame]) {
    if (!id) continue;
    for (const board of usage.get(id) ?? []) {
      if (standing.has(board.id)) continue;
      standing.set(board.id, {
        id: board.id,
        title: board.title,
        takeOff: id,
        ...(board.pages && { pages: board.pages }),
      });
    }
  }
  return [...standing.values()];
}

export function standingOnNote(
  boards: readonly BoardStandingOn[],
  limit = STANDING_ON_LIMIT,
): string | null {
  if (!boards.length) return null;
  const named = boards.slice(0, Math.max(1, limit));
  const rest = boards.length - named.length;
  const list = named
    .map(
      (board) =>
        `“${board.title.trim() || "Untitled board"}” (${board.id}), which is standing on ${board.takeOff}${usingPagesSaid(board)}`,
    )
    .join("; ");
  const more = rest ? `, and ${rest} other board${rest === 1 ? "" : "s"}` : "";
  return `this cut is filed and no board was changed. ${list}${more} — so do not say any board has been updated. If the user wants it there, call design_page with the cut's id, naming the page when one is given above, since a spread can hold the old picture twice in two differently shaped openings. If the cut is meant to *fill* that opening rather than sit loosely in it, crop again with that boardId — and that pageId — so it is held to the slot's own shape and swapped in by the same call.`;
}

export type CropOfferResult = { offer: CropOffer } | { refused: string };

export function unfittableAspect(
  frame: { width?: number | null; height?: number | null },
  aspect: unknown,
): string | null {
  const held = cropShapeOf(aspect);
  if (!held) return null;
  if (frame.width && frame.height) return null;
  return `this frame's pixel size was never recorded, so a cut of it cannot be held to ${held.label} — ask without a shape`;
}

export function cropOffer({
  reference,
  box,
  intent,
  rationale = "",
  aspect,
  loose,
  ops = [],
}: {
  reference: { id: string; title: string; width?: number | null; height?: number | null };
  box: CropBox;
  intent: string;
  rationale?: string;
  aspect?: unknown;
  loose?: string;
  ops?: readonly EditOp[];
}): CropOfferResult {
  const held = cropShapeOf(aspect);
  const unfittable = unfittableAspect(reference, held?.label);
  if (unfittable) return { refused: unfittable };
  const framed = held ? null : looseShapeOf(loose);

  const ratio = held && (quarterTurned(ops) ? 1 / held.ratio : held.ratio);
  const fitted = ratio ? cropBoxAtAspect(cropBoxColumns(box), reference, ratio) : box;
  if (!fitted) return { refused: `the image editor's box could not be held to ${held?.label}` };

  const plan = cropPlan({ box: fitted, intent, rationale, sourceTitle: reference.title, ops });
  if (!plan) {
    return { refused: "the whole frame is the shot — there is nothing to crop out of it" };
  }

  return {
    offer: {
      referenceId: reference.id,
      region: plan.region,
      cropBox: plan.cropBox,
      editIntent: plan.editIntent,
      editRationale: plan.editRationale,
      aspect: held?.label ?? null,
      ...(framed && { loose: framed.id }),
    },
  };
}

export function cropOfferShape(
  offer: CropOffer,
  frame: { width?: number | null; height?: number | null },
): string | null {
  return cropShapeMeasured(offer.cropBox, frame);
}

export function cropOfferCaption(
  offer: CropOffer,
  frame: { width?: number | null; height?: number | null },
) {
  const framed = looseShapeOf(offer.loose);
  const shape = framed
    ? [framed.label, cropOfferShape(offer, frame)].filter(Boolean).join(" · ")
    : offer.aspect;

  const said = [
    shape,
    cropCoverageLabel(offer.cropBox),
    cropSizeLabel(offer.cropBox, frame),
    cropSoftOnBoard(offer.cropBox, frame) ? "Soft on a board" : null,
  ];
  return said.filter(Boolean).join(" · ");
}

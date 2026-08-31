import {
  editOps,
  type CropBoxColumns,
  type CropOp,
  type EditOp,
} from "@/lib/edit/edit-ops";
import {
  CREDIT_JOIN,
  SAME_CUT_OVERLAP,
  boxOverlap,
  boxRegion,
  cropBoxColumns,
  cropBoxOf,
  cropRegionOfBox,
  editIntent,
  editRationale,
  type CropBox,
} from "@/lib/references/reference-version";
import { editedReferenceTitle } from "@/lib/edit/edit-said";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";

export { SAME_CUT_OVERLAP, boxOverlap };

export { editSaid } from "@/lib/edit/edit-said";

export function cropOf(edit: unknown): CropOp | null {
  return editOps(edit).find((op): op is CropOp => op.op === "crop") ?? null;
}

export function editBox(edit: unknown): CropBoxColumns | null {
  return cropOf(edit)?.box ?? null;
}

export function editShape(edit: unknown): string {
  return cropOf(edit)?.shape ?? "";
}

export function cropEdit(box: CropBox, shape?: string | null): EditOp[] {
  const columns = cropBoxColumns(box) as CropBoxColumns;
  return [{ op: "crop", box: columns, ...(shape && { shape }) }];
}

export function existingEdit<Version extends { id?: string; edit?: unknown }>(
  columns: unknown,
  versions: readonly Version[] | undefined,
  { except }: { except?: string | null } = {},
): Version | null {
  const offered = cropBoxOf(columns);
  if (!offered || !versions) return null;

  let best: { version: Version; overlap: number } | null = null;
  for (const version of versions) {
    if (except && version.id === except) continue;
    const filed = cropBoxOf(editBox(version.edit));
    if (!filed) continue;

    const overlap = boxOverlap(offered, filed);
    if (overlap >= SAME_CUT_OVERLAP && (!best || overlap > best.overlap)) {
      best = { version, overlap };
    }
  }
  return best?.version ?? null;
}

const EDIT_VERBS = { crop: "Cropped", turn: "Turned", flip: "Flipped", grade: "Graded" } as const;

export function editVerb(edit: unknown): string {
  const ops = editOps(edit);
  return ops.length === 1 ? EDIT_VERBS[ops[0]!.op] : "Edited";
}

export function versionCredit(reference: {
  editIntent?: string | null;
  edit?: unknown;
  source?: { title?: string | null } | null;
}) {
  if (!reference.source) return null;

  const frame = (reference.source.title ?? "").trim();
  const asked = editIntent(reference.editIntent ?? "");
  const from = `${editVerb(reference.edit)} from ${frame ? `“${frame}”` : "the original"}`;
  return asked ? `${from}${CREDIT_JOIN}${asked}` : from;
}

export type CropPlan = {
  region: CropRegion;
  title: string;
  editIntent: string;
  editRationale: string;
  cropBox: number[];
};

export function cropPlan({
  box,
  intent,
  rationale = "",
  sourceTitle,
  ops = [],
}: {
  box: CropBox;
  intent: string;
  rationale?: string;
  sourceTitle: string;
  ops?: readonly EditOp[];
}): CropPlan | null {
  const alsoDoes = ops.some((op) => op.op !== "crop");
  const region = cropRegionOfBox(box) ?? (alsoDoes ? boxRegion(box) : null);
  if (!region) return null;

  const columns = cropBoxColumns(box) as CropBoxColumns;
  return {
    region,
    title: editedReferenceTitle(sourceTitle, ops.length ? ops : [{ op: "crop", box: columns }]),
    editIntent: editIntent(intent),
    editRationale: editRationale(rationale),
    cropBox: columns,
  };
}

import { thumbnailBox } from "@/lib/intake/thumbnail";

export type DerivableReference = {
  width?: number | null;
  height?: number | null;
  hasThumbnail?: boolean | null;
};

function pixelSize(reference: DerivableReference) {
  const { width, height } = reference;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export function needsDerivedCopy(reference: DerivableReference) {
  if (reference.hasThumbnail) return false;

  const size = pixelSize(reference);
  if (!size) return true;

  return thumbnailBox(size.width, size.height).isNeeded;
}

export function derivationDecidesPlacement(reference: DerivableReference) {
  return needsDerivedCopy(reference) && pixelSize(reference) === null;
}

export type DerivedOffer = {
  width?: number;
  height?: number;
  thumbGcsUri?: string;
};

export type DerivedWrite = {
  update: { width?: number; height?: number; thumbGcsUri?: string };
  discard: string | null;
};

export function derivedWrite(stored: DerivableReference, offered: DerivedOffer): DerivedWrite {
  const update: DerivedWrite["update"] = {};

  const size = pixelSize(offered);
  if (size && !pixelSize(stored)) {
    update.width = size.width;
    update.height = size.height;
  }

  let discard: string | null = null;
  if (offered.thumbGcsUri) {
    if (stored.hasThumbnail) discard = offered.thumbGcsUri;
    else update.thumbGcsUri = offered.thumbGcsUri;
  }

  return { update, discard };
}

export function referencesOwedCopies<T extends { id: string } & DerivableReference>(
  rows: readonly T[] | undefined,
  tried: ReadonlySet<string>,
): T[] {
  if (!rows?.length) return [];
  return rows.filter((row) => !tried.has(row.id) && needsDerivedCopy(row));
}
